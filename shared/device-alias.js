import { getOfficialDeviceName } from './garmin-devices.js';

const STORAGE_KEY = 'garmin_device_aliases';

function getAliases() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error("Failed to load device aliases", e);
    return {};
  }
}

function saveAliases(aliases) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases));
  } catch (e) {
    console.error("Failed to save device aliases", e);
  }
}

/**
 * Returns the resolved device name. 
 * If the user set an alias for this specific serial number, it returns the alias.
 * Otherwise, it falls back to the official Garmin name.
 */
export function getDeviceAliasData(productID, serialNumber) {
  const snStr = String(serialNumber || 0).padStart(3, '0').slice(-3);
  const deviceKey = `${productID}|${snStr}`;
  const aliases = getAliases();
  const data = aliases[deviceKey];
  if (!data) return { variant: '', alias: '' };
  if (typeof data === 'string') return { variant: '', alias: data }; // backwards compatibility
  return { variant: data.variant || '', alias: data.alias || '' };
}

/**
 * Returns the resolved device name. 
 * If Alias is set -> Alias
 * Else if Variant is set -> Variant
 * Else -> Base Model (Official)
 */
export function getResolvedDeviceName(productID, manufacturerID, serialNumber) {
  const { variant, alias } = getDeviceAliasData(productID, serialNumber);
  if (alias) return alias;
  if (variant) return variant;
  return getOfficialDeviceName(productID, manufacturerID);
}

/**
 * Sets a custom variant and alias for a specific device.
 */
export function setDeviceAlias(productID, serialNumber, variant, alias) {
  const snStr = String(serialNumber || 0).padStart(3, '0').slice(-3);
  const deviceKey = `${productID}|${snStr}`;
  
  const aliases = getAliases();
  const v = (variant || '').trim();
  const a = (alias || '').trim();
  
  if (v === '' && a === '') {
    delete aliases[deviceKey];
  } else {
    aliases[deviceKey] = { variant: v, alias: a };
  }
  saveAliases(aliases);
}
