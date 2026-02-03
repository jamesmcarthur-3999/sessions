// Browser shim for wsl-utils (Node.js-only package)
export const isWsl = false
export const getWslPaths = () => ({})
export default { isWsl, getWslPaths }
