import type { Layer, Scene } from "./contracts";

const escape = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(
      /[&<>"']/g,
      (letter) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[letter]!,
    );
const str = (name: string, value: string) =>
  `<string name="${name}">${escape(value)}</string>`;
const prop = (kind: string, name: string, value: string | number | boolean) =>
  `<${kind} name="${name}">${value}</${kind}>`;
const color = (name: string, hex: string) => {
  const [r, g, b] = [1, 3, 5].map(
    (pos) => Number.parseInt(hex.slice(pos, pos + 2), 16) / 255,
  );
  return `<Color3 name="${name}"><R>${r}</R><G>${g}</G><B>${b}</B></Color3>`;
};
const udim = (name: string, scale: number, px: number) =>
  `<UDim name="${name}"><S>${scale}</S><O>${Math.round(px)}</O></UDim>`;
const udim2 = (name: string, x: number, y: number) =>
  `<UDim2 name="${name}"><XS>0</XS><XO>${Math.round(x)}</XO><YS>0</YS><YO>${Math.round(y)}</YO></UDim2>`;
const native = new Set([
  "board",
  "group",
  "rect",
  "rectangle",
  "ellipse",
  "circle",
  "text",
]);
const fonts: Record<string, string> = {
  Inter: "rbxasset://fonts/families/Roboto.json",
  Roboto: "rbxasset://fonts/families/Roboto.json",
  "Open Sans": "rbxasset://fonts/families/OpenSans.json",
  Montserrat: "rbxasset://fonts/families/Montserrat.json",
};

export type RobloxGuiNode = {
  name: string; text?: string; x: number; y: number; width: number; height: number;
  rotation: number; clip: boolean; opacity: number; fill: string | null;
  fillOpacity: number; ellipse: boolean; corners: Layer["corners"]; stroke: Layer["stroke"];
  textSize: number; fontFamily: string; horizontal: string; vertical: string; zIndex: number;
  children: RobloxGuiNode[];
};

export function exportRobloxGui(scene: Scene) {
  const byId = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const children = new Map<string | null, Layer[]>();
  for (const layer of scene.layers) {
    const list = children.get(layer.parentId) ?? [];
    list.push(layer);
    children.set(layer.parentId, list);
  }
  const selectedIds = new Set(scene.selection);
  function selectedAncestor(layer: Layer) {
    let id = layer.parentId;
    while (id) {
      if (selectedIds.has(id)) return true;
      id = byId.get(id)?.parentId ?? null;
    }
    return false;
  }
  const root = (
    selectedIds.size
      ? scene.layers.filter(
          (layer) => selectedIds.has(layer.id) && !selectedAncestor(layer),
        )
      : (children.get(null) ?? [])
  ).filter((layer) => !layer.hidden);
  if (!root.length)
    throw new Error("Select a visible board or layer in Penpot.");
  if (
    !selectedIds.size &&
    root.filter((layer) => layer.type === "board").length > 1
  ) {
    throw new Error(
      "Select the board you want to export before downloading Roblox UI.",
    );
  }
  const left = Math.min(...root.map((layer) => layer.pageX));
  const top = Math.min(...root.map((layer) => layer.pageY));
  const warnings = new Set<string>();
  let counter = 0;
  let zIndex = 0;
  const item = (className: string, properties: string[], descendants = "") =>
    `<Item class="${className}" referent="RBX${++counter}"><Properties>${properties.join("")}</Properties>${descendants}</Item>`;
  function render(
    layer: Layer,
    x: number,
    y: number,
    inheritedOpacity: number,
    instances: RobloxGuiNode[],
  ): string {
    if (layer.hidden) return "";
    if (!native.has(layer.type)) {
      warnings.add(`${layer.name}: ${layer.type} needs a raster asset.`);
      return "";
    }
    for (const limitation of layer.limitations)
      warnings.add(
        `${layer.name}: ${limitation} needs manual review in Studio.`,
      );
    const opacity = inheritedOpacity * layer.opacity;
    const text = layer.type === "text",
      ellipse = layer.type === "ellipse" || layer.type === "circle";
    if (ellipse && Math.abs(layer.width - layer.height) > 1)
      warnings.add(
        `${layer.name}: non-circular ellipse approximated by a rounded frame.`,
      );
    if (text && layer.fontFamily && layer.fontFamily !== "Roboto")
      warnings.add(`${layer.name}: review the exported Roblox font.`);
    const instance: RobloxGuiNode = {
      name: layer.name, ...(text ? { text: layer.text ?? "" } : {}), x, y,
      width: Math.max(1, layer.width), height: Math.max(1, layer.height), rotation: layer.rotation,
      clip: layer.clip, opacity, fill: layer.fill, fillOpacity: layer.fillOpacity,
      ellipse, corners: layer.corners, stroke: layer.stroke, zIndex: ++zIndex,
      textSize: Math.max(1, layer.fontSize ?? 16), fontFamily: layer.fontFamily && Object.hasOwn(fonts, layer.fontFamily) ? fonts[layer.fontFamily] : fonts.Roboto,
      horizontal: layer.align === "right" ? "Right" : layer.align === "center" ? "Center" : "Left",
      vertical: layer.verticalAlign === "bottom" ? "Bottom" : layer.verticalAlign === "center" ? "Center" : "Top",
      children: [],
    };
    instances.push(instance);
    const shapeProperties = [
      str("Name", layer.name),
      udim2("Position", x, y),
      udim2("Size", Math.max(1, layer.width), Math.max(1, layer.height)),
      prop("float", "Rotation", layer.rotation),
      prop("bool", "ClipsDescendants", layer.clip),
      prop("int", "BorderSizePixel", 0),
      prop("int", "ZIndex", instance.zIndex),
      prop(
        "float",
        "BackgroundTransparency",
        !text && layer.fill ? 1 - opacity * layer.fillOpacity : 1,
      ),
      ...(!text && layer.fill ? [color("BackgroundColor3", layer.fill)] : []),
    ];
    if (text) {
      const family = instance.fontFamily;
      shapeProperties.push(
        str("Text", layer.text ?? ""),
        prop("float", "TextSize", Math.max(1, layer.fontSize ?? 16)),
        prop("bool", "TextWrapped", true),
        color("TextColor3", layer.fill ?? "#FFFFFF"),
        prop("float", "TextTransparency", 1 - opacity * layer.fillOpacity),
        prop(
          "token",
          "TextXAlignment",
          layer.align === "right" ? 1 : layer.align === "center" ? 2 : 0,
        ),
        prop(
          "token",
          "TextYAlignment",
          layer.verticalAlign === "center"
            ? 1
            : layer.verticalAlign === "bottom"
              ? 2
              : 0,
        ),
        `<Font name="FontFace"><Family><url>${family}</url></Family><Weight>400</Weight><Style>Normal</Style></Font>`,
      );
    }
    const decorations = [];
    if (ellipse || layer.corners.some(Boolean)) {
      const names = [
        "TopLeftRadius",
        "TopRightRadius",
        "BottomRightRadius",
        "BottomLeftRadius",
      ];
      const allEqual = layer.corners.every(
        (radius) => radius === layer.corners[0],
      );
      decorations.push(
        item(
          "UICorner",
          ellipse
            ? [udim("CornerRadius", 0.5, 0)]
            : allEqual
              ? [udim("CornerRadius", 0, layer.corners[0])]
              : names.map((name, i) => udim(name, 0, layer.corners[i])),
        ),
      );
    }
    if (layer.stroke)
      decorations.push(
        item("UIStroke", [
          color("Color", layer.stroke.color),
          prop("float", "Thickness", layer.stroke.width),
          prop("float", "Transparency", 1 - layer.stroke.opacity * opacity),
          prop("token", "ApplyStrokeMode", 1),
        ]),
      );
    for (const child of children.get(layer.id) ?? [])
      decorations.push(render(child, child.x, child.y, opacity, instance.children));
    return item(
      text ? "TextLabel" : "Frame",
      shapeProperties,
      decorations.join(""),
    );
  }
  const instances: RobloxGuiNode[] = [];
  const name = root.length === 1 ? root[0].name : scene.name;
  const content = root
    .map((layer) => render(layer, layer.pageX - left, layer.pageY - top, 1, instances))
    .join("");
  if (!content)
    throw new Error(
      "The selection contains no Roblox UI layers. Export vector artwork or effects as PNG from Penpot.",
    );
  return {
    xml: `<roblox version="4"><External>null</External><External>nil</External>${item(
      "ScreenGui",
      [
        str("Name", name),
        prop("bool", "ResetOnSpawn", false),
        prop("token", "ZIndexBehavior", 0),
      ],
      content,
    )}</roblox>`,
    warnings: [...warnings],
    model: { name, instances },
  };
}
