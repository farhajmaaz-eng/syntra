export function readWorkspaceStorage(key: string) {
  return localStorage.getItem(`syntra-${key}`) ?? localStorage.getItem(`forge-${key}`);
}
