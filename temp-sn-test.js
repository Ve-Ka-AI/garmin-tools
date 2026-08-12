const fs = require('fs');
const path = require('path');
const FIT_PATH = 'C:\\Users\\vasek\\garmin-tools\\fit-test-files';

// A minimal script to find the actual strings inside FIT files
function scanFitForStrings(buffer) {
  const strings = [];
  // simple strings extraction: sequences of 5+ printable ASCII chars
  let currentString = '';
  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];
    if (char >= 32 && char <= 126) { // printable ascii
      currentString += String.fromCharCode(char);
    } else {
      if (currentString.length >= 6) {
        strings.push(currentString);
      }
      currentString = '';
    }
  }
  return strings;
}

try {
  const dir = fs.readdirSync(FIT_PATH);
  for (let f of dir) {
    if (f.toLowerCase().endsWith('.fit')) {
      const p = path.join(FIT_PATH, f);
      const buf = fs.readFileSync(p);
      const strs = scanFitForStrings(buf);
      
      const candidateSn = strs.filter(s => s.match(/^[0-9A-Z]{8,10}$/));
      if (candidateSn.length > 0) {
        console.log(`File: ${f} -> Candidates for SN:`, candidateSn);
      }
      
      // Let's also just look at all unique strings in one file to see what's there
      if (f === dir[0]) {
        console.log(`All strings in ${f}:`, Array.from(new Set(strs)));
      }
    }
  }
} catch (e) {
  console.log("Error:", e.message);
}
