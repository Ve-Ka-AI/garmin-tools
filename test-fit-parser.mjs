/**
 * Garmin Tools — Ověřovací test sdíleného FIT parseru
 * Spouštět přes Node.js: node test-fit-parser.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamický import sdíleného modulu (Node.js ESM kompatibilita)
const fitCorePath = join(__dirname, 'shared', 'fit-core.js');
const { parseFitBinary, calcHaversine, calcFitCrc, garminTimestampToDate, GARMIN_EPOCH_OFFSET } = await import('file:///' + fitCorePath.replace(/\\/g, '/'));

const testDir = join(__dirname, 'FITs for tests');
const files = readdirSync(testDir).filter(f => f.toLowerCase().endsWith('.fit'));

console.log(`\n🔧 Garmin Tools — Test sdíleného FIT parseru`);
console.log(`📁 Testovací adresář: ${testDir}`);
console.log(`📄 Nalezeno souborů: ${files.length}\n`);
console.log('─'.repeat(90));

let okFull = 0, okPos = 0, failFull = 0, failPos = 0;
let totalRecords = 0;

for (const file of files) {
  const filePath = join(testDir, file);
  const buf = readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  // Test režim 'full'
  const full = parseFitBinary(arrayBuffer, { mode: 'full', filename: file });
  // Test režim 'position-only'
  const pos = parseFitBinary(arrayBuffer, { mode: 'position-only', filename: file });

  const fullOk = full && full.records && full.records.length > 0;
  const posOk = pos && pos.lat !== undefined;

  if (fullOk) {
    okFull++;
    totalRecords += full.records.length;

    // Ověření timestamp konverze
    const firstRec = full.records[0];
    if (firstRec.timestamp) {
      const date = garminTimestampToDate(firstRec.timestamp);
      if (!(date instanceof Date) || isNaN(date.getTime())) {
        console.log(`⚠️  ${file}: timestamp konverze selhala`);
      }
    }
  } else {
    failFull++;
  }

  if (posOk) {
    okPos++;
  } else {
    failPos++;
  }

  const status = fullOk ? '✅' : '❌';
  const posStatus = posOk ? '✅' : '❌';
  const recCount = fullOk ? full.records.length : 0;
  const hasSession = fullOk && full.sessionData ? '📊' : '  ';
  const hasDevice = fullOk && full.deviceInfos && full.deviceInfos.length > 0 ? '📱' : '  ';
  const latLng = posOk ? `${pos.lat.toFixed(4)}°, ${pos.lng.toFixed(4)}°` : 'N/A';

  console.log(`${status} full:${String(recCount).padStart(5)} rec  ${posStatus} pos: ${latLng.padEnd(24)} ${hasSession}${hasDevice}  ${file}`);
}

console.log('─'.repeat(90));
console.log(`\n📊 VÝSLEDKY:`);
console.log(`   Full mód:     ${okFull}/${files.length} úspěšných (${failFull} selhání)`);
console.log(`   Position mód: ${okPos}/${files.length} úspěšných (${failPos} selhání)`);
console.log(`   Celkem záznamů: ${totalRecords.toLocaleString('cs-CZ')}`);

// Test Haversine
const praha = { lat: 50.0755, lng: 14.4378 };
const brno = { lat: 49.1951, lng: 16.6068 };
const dist = calcHaversine(praha.lat, praha.lng, brno.lat, brno.lng);
console.log(`\n🌍 Haversine test: Praha → Brno = ${(dist / 1000).toFixed(1)} km ${Math.abs(dist - 185000) < 5000 ? '✅' : '❌'}`);

// Test CRC-16
const testBytes = new Uint8Array([0x0E, 0x20, 0x18, 0x53, 0x00, 0x00, 0x00, 0x00, 0x2E, 0x46, 0x49, 0x54]);
const crc = calcFitCrc(testBytes, 0, 12);
console.log(`🔐 CRC-16 test: ${crc !== 0 ? '✅' : '❌'} (CRC = 0x${crc.toString(16).toUpperCase()})`);

console.log(`\n✨ Test dokončen.\n`);
