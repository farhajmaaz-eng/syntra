import { createHash } from "node:crypto";
import { z } from "zod";
import { readPenpotScene, revisionFor } from "../src/graphics/penpot";
import { exportRobloxGui, type RobloxGuiNode } from "../src/graphics/roblox";
import { db } from "./store";

export const stageDesignSchema = z.strictObject({
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  boardId: z.string().min(1).max(200),
});
export const importDesignSchema = z.strictObject({ sourceTaskId: z.string().min(1).max(200) });

type Staged = {
  summary: { boardId: string; name: string; revision: string; warnings: string[]; transferId: string };
  model: { name: string; instances: RobloxGuiNode[] };
};

export async function stageDesign(input: unknown): Promise<Staged> {
  const { revision, boardId } = stageDesignSchema.parse(input);
  const scene = await readPenpotScene();
  if (revisionFor(scene) !== revision) throw new Error("Penpot changed. Inspect the current revision before staging.");
  if (!scene.layers.some(layer => layer.id === boardId && layer.type === "board" && !layer.hidden)) {
    throw new Error("Choose a visible Penpot board from design_inspect.");
  }
  const { model, warnings } = exportRobloxGui({ ...scene, selection: [boardId] });
  const content = JSON.stringify(model);
  if (Buffer.byteLength(content) > 96_000) throw new Error("This board is too large for a single Studio import. Use a smaller board or the Graphics download.");
  const transferId = createHash("sha256").update(scene.fileId).update(boardId).update(content).digest("hex");
  return { summary: { boardId, revision, warnings, transferId, name: model.name }, model };
}

export function stagedDesign(taskId: string, runId: string): Staged | undefined {
  const row = db.prepare(`
    SELECT c.result FROM tool_calls c JOIN tasks t ON t.id=c.task_id
    WHERE t.id=? AND t.run_id=? AND t.agent='Frame' AND t.status='completed'
      AND c.tool='design_stage' AND c.status='done'
    ORDER BY c.rowid DESC LIMIT 1
  `).get(taskId, runId) as { result: string } | undefined;
  return row ? JSON.parse(row.result) as Staged : undefined;
}

// The only interpolated value is JSON inside a long string with a non-matching delimiter.
export function renderDesignInstall(staged: Staged) {
  const data = JSON.stringify({ ...staged.model, transferId: staged.summary.transferId });
  let marker = "=";
  while (data.includes(`]${marker}]`)) marker += "=";
  return `
local data = game:GetService("HttpService"):JSONDecode([${marker}[${data}]${marker}])
assert(not game:GetService("RunService"):IsRunning(), "Stop the playtest before importing UI")
local parent = game:GetService("StarterGui")
local previous = parent:FindFirstChild(data.name)
if previous then
  assert(previous:IsA("ScreenGui") and previous:GetAttribute("SyntraGraphicsTransfer") == data.transferId,
    "StarterGui already has a different object with this name. Rename the Penpot board and stage it again.")
  return "Already imported: StarterGui/" .. data.name
end
local gui = Instance.new("ScreenGui")
local function color(hex)
  return Color3.fromRGB(tonumber(hex:sub(2,3),16), tonumber(hex:sub(4,5),16), tonumber(hex:sub(6,7),16))
end
local function build(row, container)
  local text = row.text ~= nil
  local node = Instance.new(text and "TextLabel" or "Frame")
  node.Parent = container
  node.Name = row.name
  node.Position = UDim2.fromOffset(math.round(row.x), math.round(row.y))
  node.Size = UDim2.fromOffset(math.round(row.width), math.round(row.height))
  node.Rotation = row.rotation
  node.ClipsDescendants = row.clip
  node.BorderSizePixel = 0
  node.ZIndex = row.zIndex
  node.BackgroundTransparency = 1
  local alpha = row.opacity * row.fillOpacity
  if text then
    node.Text = row.text
    node.TextSize = row.textSize
    node.TextWrapped = true
    node.TextColor3 = color(row.fill or "#FFFFFF")
    node.TextTransparency = 1 - alpha
    node.TextXAlignment = Enum.TextXAlignment[row.horizontal]
    node.TextYAlignment = Enum.TextYAlignment[row.vertical]
    node.FontFace = Font.new(row.fontFamily)
  elseif row.fill then
    node.BackgroundColor3 = color(row.fill)
    node.BackgroundTransparency = 1 - alpha
  end
  local r = row.corners
  if row.ellipse or math.max(r[1], r[2], r[3], r[4]) > 0 then
    local corner = Instance.new("UICorner")
    corner.Parent = node
    if row.ellipse then
      corner.CornerRadius = UDim.new(0.5, 0)
    elseif r[1] == r[2] and r[2] == r[3] and r[3] == r[4] then
      corner.CornerRadius = UDim.new(0, math.round(r[1]))
    else
      corner.TopLeftRadius = UDim.new(0, math.round(r[1]))
      corner.TopRightRadius = UDim.new(0, math.round(r[2]))
      corner.BottomRightRadius = UDim.new(0, math.round(r[3]))
      corner.BottomLeftRadius = UDim.new(0, math.round(r[4]))
    end
  end
  if row.stroke then
    local stroke = Instance.new("UIStroke")
    stroke.Parent = node
    stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    stroke.Thickness = row.stroke.width
    stroke.Transparency = 1 - row.stroke.opacity * row.opacity
    stroke.Color = color(row.stroke.color)
  end
  for _, child in ipairs(row.children) do build(child, node) end
end
local success, problem = pcall(function()
  gui.Name = data.name
  gui.ResetOnSpawn = false
  gui.ZIndexBehavior = Enum.ZIndexBehavior.Global
  gui:SetAttribute("SyntraGraphicsTransfer", data.transferId)
  for _, row in ipairs(data.instances) do build(row, gui) end
  gui.Parent = parent
end)
if not success then
  gui:Destroy()
  error(problem)
end
return "Imported: StarterGui/" .. data.name
`;
}
