import { PlaywrightClient } from './lib/client/playwright-client.js';

async function testOutlineCompression() {
  const client = new PlaywrightClient('http://localhost:3102');

  try {
    console.log('🚀 Starting outline compression test...\n');

    console.log('📄 Creating test page...');
    const page = await client.createPage('test-outline', 'Test outline compression', 'https://example.com');
    const pageId = page.pageId;
    console.log(`✅ Page created，ID: ${pageId}\n`);

    await client.waitForTimeout(pageId, 2000);

    console.log('🧾 Getting original snapshot...');
    const rawSnapshot = await client.getSnapshot(pageId);
    console.log(`  - Original snapshot lines: ${rawSnapshot.snapshot.split('\n').length}`);
    console.log(`  - Original snapshot size: ${rawSnapshot.snapshot.length} chars`);

    console.log('\n🧠 Generating outline...');
    const outline = await client.getOutline(pageId);
    console.log(`  - Outline lines: ${outline.split('\n').length}`);
    console.log(`  - Outline size: ${outline.length} chars`);

    const ratio = ((1 - (outline.length / Math.max(rawSnapshot.snapshot.length, 1))) * 100).toFixed(2);
    console.log(`  - Compression ratio: ${ratio}%`);

    console.log('\n🧹 Cleaning up page...');
    await client.closePage(pageId);
    console.log('✅ Test completed！');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testOutlineCompression();
