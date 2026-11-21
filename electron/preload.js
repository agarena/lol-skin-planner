'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lol', {
  info: () => ipcRenderer.invoke('app:info'),
  status: (force) => ipcRenderer.invoke('lcu:status', force),
  collection: (force) => ipcRenderer.invoke('lcu:collection', force),
  catalogLoad: (force) => ipcRenderer.invoke('catalog:load', force),
  catalogClear: () => ipcRenderer.invoke('catalog:clear'),
  storeProbe: () => ipcRenderer.invoke('store:probe'),
  storePrices: (skinIds) => ipcRenderer.invoke('store:prices', skinIds),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  skinParse: (payload) => ipcRenderer.invoke('skin:parse', payload),
  usage: (force) => ipcRenderer.invoke('usage:load', force),
  storeItems: (opts) => ipcRenderer.invoke('store:items', opts),
  storeMythic: (opts) => ipcRenderer.invoke('store:mythic', opts),
  championStats: (opts) => ipcRenderer.invoke('stats:champions', opts),
  listPlans: () => ipcRenderer.invoke('plans:list'),
  savePlan: (payload) => ipcRenderer.invoke('plans:save', payload),
  deletePlan: (id) => ipcRenderer.invoke('plans:delete', id),
  sharePlan: (id) => ipcRenderer.invoke('plans:share', id),
  importPlan: (payload) => ipcRenderer.invoke('plans:import', payload),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  copyText: (text) => ipcRenderer.invoke('app:copyText', text),
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('win:close'),
  relaunchElevated: () => ipcRenderer.invoke('app:relaunchElevated'),
})
