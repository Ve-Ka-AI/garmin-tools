/**
 * Garmin Tools — Sdílený FIT binární parser
 * ==========================================
 * Sjednocený nativní parser pro Garmin .FIT soubory.
 * Využívá DataView/Uint8Array pro maximální výkon v prohlížeči.
 *
 * Režimy:
 *   'full'          — kompletní parsování (records, deviceInfos, session, fileId, devFields)
 *   'position-only' — vrací první validní {lat, lng, timestamp} (ultra-rychlý)
 *
 * Exportované funkce:
 *   parseFitBinary(arrayBuffer, options?)
 *   calcHaversine(lat1, lon1, lat2, lon2)
 *   calcFitCrc(bytes, start, end)
 *   garminTimestampToDate(rawTs)
 *   dateToGarminTimestamp(date)
 */

// ===== KONSTANTY =====

/** Offset mezi Unix epoch (1970) a Garmin epoch (1989-12-31T00:00:00Z) */
export const GARMIN_EPOCH_OFFSET = 631065600;

/** Převodní faktor semicircle → stupně */
export const SEMICIRCLE_TO_DEG = 180.0 / 2147483648.0;

/** Marker pro nevalidní sint32 pozici v FIT protokolu */
export const FIT_INVALID_SINT32 = 0x7FFFFFFF;

/** Marker pro nevalidní uint32 v FIT protokolu */
export const FIT_INVALID_UINT32 = 0xFFFFFFFF;

// ===== CRC-16 =====

const fitCrcTable = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400
];

/**
 * Výpočet CRC-16 pro FIT soubory (Garmin CRC algoritmus).
 * @param {Uint8Array} bytes - Pole bajtů
 * @param {number} start - Počáteční index
 * @param {number} end - Koncový index (exkluzivní)
 * @returns {number} CRC-16 hodnota
 */
export function calcFitCrc(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    let tmp = fitCrcTable[crc & 0x0F];
    crc = (crc >> 4) ^ tmp ^ fitCrcTable[byte & 0x0F];
    tmp = fitCrcTable[crc & 0x0F];
    crc = (crc >> 4) ^ tmp ^ fitCrcTable[(byte >> 4) & 0x0F];
  }
  return crc;
}

// ===== HAVERSINE =====

/**
 * Výpočet vzdálenosti (v metrech) mezi dvěma GPS body pomocí Haversine formule.
 * @param {number} lat1 - Zeměpisná šířka bodu 1 (stupně)
 * @param {number} lon1 - Zeměpisná délka bodu 1 (stupně)
 * @param {number} lat2 - Zeměpisná šířka bodu 2 (stupně)
 * @param {number} lon2 - Zeměpisná délka bodu 2 (stupně)
 * @returns {number} Vzdálenost v metrech
 */
export function calcHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ===== TIMESTAMP KONVERZE =====

/**
 * Převede raw Garmin timestamp na JavaScript Date objekt.
 * @param {number} rawTs - Raw Garmin timestamp (sekundy od Garmin epoch)
 * @returns {Date} JavaScript Date objekt
 */
export function garminTimestampToDate(rawTs) {
  return new Date((rawTs + GARMIN_EPOCH_OFFSET) * 1000);
}

/**
 * Převede JavaScript Date na raw Garmin timestamp.
 * @param {Date} date - JavaScript Date objekt
 * @returns {number} Raw Garmin timestamp
 */
export function dateToGarminTimestamp(date) {
  return Math.round(date.getTime() / 1000) - GARMIN_EPOCH_OFFSET;
}

// ===== HLAVNÍ PARSER =====

/**
 * Parsuje binární Garmin .FIT soubor.
 *
 * @param {ArrayBuffer} arrayBuffer - Surový obsah .FIT souboru
 * @param {Object} [options] - Volitelné parametry
 * @param {'full'|'position-only'} [options.mode='full'] - Režim parsování
 * @param {string} [options.filename=''] - Název souboru (pro fallback detekci)
 * @returns {Object|null} Výsledek parsování, nebo null pokud soubor není validní FIT
 *
 * V režimu 'full' vrací:
 *   { records, deviceInfos, sessionData, fileId, fieldDescriptions }
 *
 * V režimu 'position-only' vrací:
 *   { lat, lng, timestamp } — první validní GPS pozice
 */
export function parseFitBinary(arrayBuffer, options = {}) {
  const mode = options.mode || 'full';
  const filename = options.filename || '';

  try {
    const data = new Uint8Array(arrayBuffer);
    if (data.length < 14) return null;

    // Ověření FIT magic bytes '.FIT' na offsetu 8..11
    const isFitMagic = (data[8] === 46 && data[9] === 70 && data[10] === 73 && data[11] === 84);
    if (!isFitMagic && !filename.toLowerCase().endsWith('.fit')) return null;

    const headerSize = data[0];
    const view = new DataView(arrayBuffer);
    const dataSize = view.getUint32(4, true);
    const bodyEnd = Math.min(headerSize + dataSize, data.length);

    if (mode === 'position-only') {
      return _parsePositionOnly(data, view, headerSize, bodyEnd);
    }

    return _parseFull(data, view, headerSize, bodyEnd);
  } catch (e) {
    console.error('FIT parser chyba:', e);
    return null;
  }
}

// ===== FULL PARSER (Activity Comparator & Repair Studio) =====

function _parseFull(data, view, headerSize, bodyEnd) {
  const defs = {};
  const fieldDescriptions = {};
  const records = [];
  const deviceInfos = [];
  let sessionData = null;
  const fileId = {};
  let lastRecordTimestamp = null;

  let idx = headerSize;
  while (idx < bodyEnd) {
    const hdr = data[idx++];
    const isCompressed = (hdr & 0x80) !== 0;

    if (isCompressed) {
      const localMsgType = (hdr >> 5) & 0x03;
      const def = defs[localMsgType];
      if (!def) continue;

      const isLittle = def.isLittle;
      const msgData = {};
      for (const field of def.fields) {
        if (idx + field.size > data.length) break;
        msgData[field.num] = { raw: data.subarray(idx, idx + field.size), size: field.size };
        idx += field.size;
      }

      const devData = {};
      if (def.devFields) {
        for (const df of def.devFields) {
          if (idx + df.size > data.length) break;
          const rawDev = data.subarray(idx, idx + df.size);
          idx += df.size;
          const dName = fieldDescriptions[`${df.idx}_${df.num}`];
          if (dName) devData[dName] = { raw: rawDev, size: df.size };
        }
      }

      if (def.gNum === 20) {
        const rec = _parseRecordFields(msgData, devData, isLittle);
        if (!rec.timestamp && lastRecordTimestamp !== null) {
          rec.timestamp = lastRecordTimestamp + 1;
        }
        if (rec.timestamp) lastRecordTimestamp = rec.timestamp;
        if (rec.lat !== undefined || rec.lng !== undefined || rec.timestamp) {
          records.push(rec);
        }
      }
    } else {
      const isDef = (hdr & 0x40) !== 0;
      const hasDev = (hdr & 0x20) !== 0;
      const localMsgType = hdr & 0x0F;

      if (isDef) {
        if (idx + 5 > bodyEnd) break;
        const reserved = data[idx++];
        const arch = data[idx++];
        const isLittle = (arch === 0);
        const gNum = view.getUint16(idx, isLittle);
        idx += 2;
        const numFields = data[idx++];
        const fields = [];
        for (let f = 0; f < numFields; f++) {
          if (idx + 3 > bodyEnd) break;
          fields.push({ num: data[idx], size: data[idx + 1], type: data[idx + 2] });
          idx += 3;
        }
        const devFields = [];
        if (hasDev) {
          if (idx >= bodyEnd) break;
          const numDev = data[idx++];
          for (let d = 0; d < numDev; d++) {
            if (idx + 3 > bodyEnd) break;
            devFields.push({ num: data[idx], size: data[idx + 1], idx: data[idx + 2] });
            idx += 3;
          }
        }
        defs[localMsgType] = { gNum, isLittle, fields, devFields };
      } else {
        const def = defs[localMsgType];
        if (!def) continue;
        const isLittle = def.isLittle;
        const msgData = {};
        for (const field of def.fields) {
          if (idx + field.size > data.length) break;
          msgData[field.num] = { raw: data.subarray(idx, idx + field.size), size: field.size };
          idx += field.size;
        }

        const devData = {};
        if (def.devFields) {
          for (const df of def.devFields) {
            if (idx + df.size > data.length) break;
            const rawDev = data.subarray(idx, idx + df.size);
            idx += df.size;
            const dName = fieldDescriptions[`${df.idx}_${df.num}`];
            if (dName) devData[dName] = { raw: rawDev, size: df.size };
          }
        }

        const gNum = def.gNum;
        if (gNum === 0) { // file_id
          for (const fNum in msgData) {
            const { raw, size } = msgData[fNum];
            const dv = new DataView(raw.buffer, raw.byteOffset, size);
            if (fNum == 1 && size === 2) fileId.manufacturer = dv.getUint16(0, isLittle);
            else if (fNum == 2 && size === 2) fileId.product = dv.getUint16(0, isLittle);
            else if (fNum == 3 && size === 4) fileId.serialNumber = dv.getUint32(0, isLittle);
            else if (fNum == 4 && size === 4) fileId.timeCreated = dv.getUint32(0, isLittle);
          }
        } else if (gNum === 206) { // field_description
          let fName = '', fDefNum = null, dIdx = null;
          for (const fNum in msgData) {
            const { raw, size } = msgData[fNum];
            if (fNum == 3) {
              const decoder = new TextDecoder('utf-8');
              fName = decoder.decode(raw).replace(/\0/g, '').toLowerCase();
            } else if (fNum == 1) fDefNum = raw[0];
            else if (fNum == 0) dIdx = raw[0];
          }
          if (fDefNum !== null && dIdx !== null && fName) {
            fieldDescriptions[`${dIdx}_${fDefNum}`] = fName;
          }
        } else if (gNum === 23) { // device_info
          const dItem = {};
          for (const fNum in msgData) {
            const { raw, size } = msgData[fNum];
            const dv = new DataView(raw.buffer, raw.byteOffset, size);
            if (fNum == 0 && size === 1) dItem.deviceIndex = raw[0];
            else if (fNum == 1 && size === 1) dItem.deviceType = raw[0];
            else if (fNum == 2 && size === 2) dItem.manufacturer = dv.getUint16(0, isLittle);
            else if (fNum == 4 && size === 2) dItem.softwareVersion = dv.getUint16(0, isLittle) / 100.0;
            else if (fNum == 5 && size === 4) dItem.serialNumber = dv.getUint32(0, isLittle);
            else if (fNum == 25 && size === 1) dItem.antplusDeviceType = raw[0];
            else if (fNum == 11 && size === 1) dItem.batteryLevel = raw[0];
          }
          deviceInfos.push(dItem);
        } else if (gNum === 18) { // session
          const sItem = {};
          for (const fNum in msgData) {
            const { raw, size } = msgData[fNum];
            const dv = new DataView(raw.buffer, raw.byteOffset, size);
            if (size === 1) sItem[fNum] = raw[0];
            else if (size === 2) sItem[fNum] = dv.getUint16(0, isLittle);
            else if (size === 4) sItem[fNum] = dv.getUint32(0, isLittle);
          }
          sessionData = sItem;
        } else if (gNum === 20) { // record
          const rec = _parseRecordFields(msgData, devData, isLittle);
          if (!rec.timestamp && lastRecordTimestamp !== null) {
            rec.timestamp = lastRecordTimestamp;
          }
          if (rec.timestamp) lastRecordTimestamp = rec.timestamp;
          if (rec.timestamp || (rec.lat !== undefined && rec.lng !== undefined)) {
            records.push(rec);
          }
        }
      }
    }
  }

  if (records.length === 0) return null;

  return {
    records,
    deviceInfos,
    sessionData,
    fileId,
    fieldDescriptions
  };
}

// ===== RECORD FIELDS PARSER =====

function _parseRecordFields(msgData, devData, isLittle) {
  const rec = {};

  for (const fNum in msgData) {
    const { raw, size } = msgData[fNum];
    const dv = new DataView(raw.buffer, raw.byteOffset, size);

    if (fNum == 253 && size === 4) {
      const rawTs = dv.getUint32(0, isLittle);
      if (rawTs !== FIT_INVALID_UINT32 && rawTs > 0) {
        rec.timestamp = rawTs; // Raw garmin timestamp — konverzi na Date provádí aplikační vrstva
      }
    }
    else if (fNum == 0 && size === 4) {
      const rawLat = dv.getInt32(0, isLittle);
      if (rawLat !== FIT_INVALID_SINT32 && rawLat !== 0 && rawLat !== -2147483648) {
        rec.lat = rawLat * SEMICIRCLE_TO_DEG;
      }
    }
    else if (fNum == 1 && size === 4) {
      const rawLng = dv.getInt32(0, isLittle);
      if (rawLng !== FIT_INVALID_SINT32 && rawLng !== 0 && rawLng !== -2147483648) {
        rec.lng = rawLng * SEMICIRCLE_TO_DEG;
      }
    }
    else if (fNum == 78 && size === 4) {
      rec.alt = dv.getUint32(0, isLittle) / 5.0 - 500.0;
    }
    else if (fNum == 2 && size === 2 && rec.alt === undefined) {
      rec.alt = dv.getUint16(0, isLittle) / 5.0 - 500.0;
    }
    else if (fNum == 3 && size === 1) rec.hr = raw[0];
    else if (fNum == 4 && size === 1) rec.cadence = raw[0];
    else if (fNum == 73 && size === 4) {
      rec.speed = dv.getUint32(0, isLittle) / 1000.0;
    }
    else if (fNum == 6 && size === 2 && rec.speed === undefined) {
      rec.speed = dv.getUint16(0, isLittle) / 1000.0;
    }
    else if ((fNum == 5 || fNum == 77) && size === 4) {
      rec.dist = dv.getUint32(0, isLittle) / 100.0;
    }
    else if (fNum == 7 && size === 2) rec.power = dv.getUint16(0, isLittle);
    else if (fNum == 13 && size === 1) rec.temp = dv.getInt8(0);
    else if (fNum == 90 && size === 1) rec.battery = raw[0];
    else if (fNum == 61 && size === 2) rec.epe = dv.getUint16(0, isLittle) / 100.0;
    else if ((fNum == 137 || fNum == 138) && size === 1 && raw[0] <= 100) rec.stamina = raw[0];
    else if (fNum == 114 && size === 4) rec.grit = dv.getFloat32(0, isLittle);
    else if (fNum == 115 && size === 4) rec.flow = dv.getFloat32(0, isLittle);
  }

  // Developer fields (baterie, GPS kvalita)
  if (devData) {
    for (const dName in devData) {
      const { raw, size } = devData[dName];
      const dv = new DataView(raw.buffer, raw.byteOffset, size);
      if (dName.includes('battery')) {
        rec.devBattery = size === 4 ? dv.getFloat32(0, isLittle) : raw[0];
      } else if (dName.includes('gps') || dName.includes('quality')) {
        rec.devGpsQuality = raw[0];
      }
    }
  }

  return rec;
}

// ===== POSITION-ONLY PARSER (Watch Finder) =====

function _parsePositionOnly(data, view, headerSize, bodyEnd) {
  const defs = {};
  let idx = headerSize;

  while (idx < bodyEnd) {
    const hdr = data[idx++];

    if ((hdr & 0x80) === 0) { // Normal Header
      const localMsgType = hdr & 0x0F;
      const isDef = (hdr & 0x40) !== 0;
      const hasDev = (hdr & 0x20) !== 0;

      if (isDef) {
        if (idx + 5 > bodyEnd) break;
        const arch = data[idx + 1];
        const globalMsgNum = view.getUint16(idx + 2, arch === 0);
        idx += 4;
        const numFields = data[idx++];

        const fields = [];
        for (let f = 0; f < numFields; f++) {
          if (idx + 3 > bodyEnd) break;
          fields.push({ num: data[idx], size: data[idx + 1], type: data[idx + 2] });
          idx += 3;
        }

        const devFields = [];
        if (hasDev) {
          if (idx >= bodyEnd) break;
          const numDev = data[idx++];
          for (let d = 0; d < numDev; d++) {
            if (idx + 3 > bodyEnd) break;
            devFields.push({ num: data[idx], size: data[idx + 1], idx: data[idx + 2] });
            idx += 3;
          }
        }
        defs[localMsgType] = { globalMsgNum, arch, fields, devFields };
      } else {
        const def = defs[localMsgType];
        if (!def) break;

        let lat = null, lng = null, ts = null;
        const isLittle = (def.arch === 0);

        for (const field of def.fields) {
          if (idx + field.size > data.length) break;

          if (def.globalMsgNum === 20 || def.globalMsgNum === 18 || def.globalMsgNum === 19) {
            if ((field.num === 0 || field.num === 3) && field.size === 4) {
              lat = view.getInt32(idx, isLittle);
            } else if ((field.num === 1 || field.num === 4) && field.size === 4) {
              lng = view.getInt32(idx, isLittle);
            } else if ((field.num === 253 || field.num === 2) && field.size === 4) {
              ts = view.getUint32(idx, isLittle);
            }
          }
          idx += field.size;
        }

        if (def.devFields) {
          for (const df of def.devFields) idx += df.size;
        }

        if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
          const latDeg = lat * SEMICIRCLE_TO_DEG;
          const lngDeg = lng * SEMICIRCLE_TO_DEG;
          if (latDeg >= -90 && latDeg <= 90 && lngDeg >= -180 && lngDeg <= 180) {
            return {
              lat: latDeg,
              lng: lngDeg,
              timestamp: ts ? garminTimestampToDate(ts) : null
            };
          }
        }
      }
    } else { // Compressed Timestamp Header
      const localMsgType = (hdr >> 5) & 0x03;
      const def = defs[localMsgType];
      if (!def) break;
      for (const field of def.fields) idx += field.size;
      if (def.devFields) for (const df of def.devFields) idx += df.size;
    }
  }

  return null;
}
