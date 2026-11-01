// Fixed, trusted worker: no eval, dynamic imports, shell, network or environment access.
let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { text += chunk; if (text.length > 32768) process.exit(2); });
process.stdin.on('end', () => {
  try {
    const { numbers } = JSON.parse(text);
    if (!Array.isArray(numbers) || numbers.length > 100 || !numbers.every(n => Number.isFinite(n) && Math.abs(n) <= 1000000)) process.exit(2);
    process.stdout.write(JSON.stringify({ sum: numbers.reduce((a, b) => a + b, 0) }));
  } catch { process.exitCode = 2; }
});
