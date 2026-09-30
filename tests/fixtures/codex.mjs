import { readFile, writeFile } from 'node:fs/promises';
if (process.argv.includes('--version')) {
  await writeFile('observed-input.json', await readFile('../progress.json', 'utf8'));
  process.stdout.write('vibe-fixture 1\n');
} else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const model = process.argv[process.argv.indexOf('--model') + 1];
  const finalPath = process.argv[process.argv.indexOf('--output-last-message') + 1];
  if (prompt.includes('FIXTURE_WAIT')) await new Promise((resolve) => setTimeout(resolve, 60_000));
  if (prompt.includes('FIXTURE_FAIL')) { process.stderr.write('fixture failure\n'); process.exitCode = 2; }
  else {
    const text = model === 'gpt-6-luna'
      ? 'An index is like the alphabetical index at the back of a book. Instead of reading every page to find a topic, you look up the topic and jump to its page. A database index similarly points to matching rows. The tradeoff is extra storage and slower writes, because changes must update the index too.'
      : 'Imagine a library with a catalog. Without it, you inspect every shelf to find a title. With it, a short lookup tells you exactly where to go. A database index is that catalog for a column. It makes lookups faster, but adding or changing a row also means updating the catalog, so writes take more work.';
    await writeFile(finalPath, prompt.includes('FIXTURE_HTML') ? '<script>window.compromised=true</script>\n' + text : text);
    process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }) + '\n');
  }
}
