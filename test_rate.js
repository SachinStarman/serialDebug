// Quick test: measure actual data rate on COM15
const { SerialPort } = require('serialport');

const port = new SerialPort({ path: 'COM15', baudRate: 115200 });
let lineBuffer = '';
let lineCount = 0;
let byteCount = 0;
const startTime = Date.now();
let lastSecond = startTime;
let linesThisSecond = 0;

port.on('data', (data) => {
  byteCount += data.length;
  lineBuffer += data.toString();
  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop(); // keep partial
  const newLines = lines.length;
  lineCount += newLines;
  linesThisSecond += newLines;

  const now = Date.now();
  if (now - lastSecond >= 1000) {
    const elapsed = (now - startTime) / 1000;
    const avgRate = lineCount / elapsed;
    console.log(`[${elapsed.toFixed(1)}s] Lines this second: ${linesThisSecond} | Total: ${lineCount} | Avg: ${avgRate.toFixed(1)} lines/s | Bytes: ${byteCount}`);
    if (newLines > 0) {
      console.log(`  Last line: "${lines[lines.length - 1].trim()}"`);
    }
    linesThisSecond = 0;
    lastSecond = now;
  }
});

port.on('error', (err) => console.error('Error:', err.message));
port.on('open', () => console.log('Opened COM15 at 115200. Measuring data rate for 15 seconds...\n'));

// Stop after 15 seconds
setTimeout(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== FINAL: ${lineCount} lines in ${elapsed.toFixed(1)}s = ${(lineCount / elapsed).toFixed(1)} lines/sec ===`);
  console.log(`=== That's ${(elapsed * 1000 / lineCount).toFixed(2)} ms per line ===`);
  port.close(() => process.exit(0));
}, 15000);
