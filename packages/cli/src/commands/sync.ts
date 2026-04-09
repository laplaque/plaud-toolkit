import * as fs from 'fs';
import * as path from 'path';
import { PlaudConfig, PlaudAuth, PlaudClient } from '@plaud/core';

type ContentMode = 'all' | 'transcript' | 'notes';

function parseArgs(args: string[]): { folder: string; content: ContentMode } {
  let content: ContentMode = 'all';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--content' && i + 1 < args.length) {
      const val = args[i + 1];
      if (val === 'transcript' || val === 'notes' || val === 'all') {
        content = val;
      } else {
        console.error(`Invalid --content value: ${val}. Use: all, transcript, notes`);
        process.exit(1);
      }
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  const folder = positional[0];
  if (!folder) {
    console.error('Usage: plaud sync [--content all|transcript|notes] <folder>');
    process.exit(1);
  }

  return { folder, content };
}

export async function syncCommand(args: string[]): Promise<void> {
  const { folder, content } = parseArgs(args);

  const config = new PlaudConfig();
  const creds = config.getCredentials();
  const configData = config.load() as any;
  const region = creds?.region ?? configData.region ?? 'eu';
  const auth = new PlaudAuth(config);
  const client = new PlaudClient(auth, region);

  fs.mkdirSync(folder, { recursive: true });

  const recordings = await client.listRecordings();
  console.log(`Found ${recordings.length} recording(s). Syncing ${content} content...`);

  let synced = 0;
  for (const rec of recordings) {
    const date = new Date(rec.start_time).toISOString().slice(0, 10);
    const slug = rec.filename?.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 50) || rec.id;
    const mdFile = path.join(folder, `${date}_${slug}.md`);

    if (fs.existsSync(mdFile)) continue;

    // Pre-filter: skip recordings without relevant content
    if (content === 'transcript' && !rec.is_trans) {
      console.log(`Skipping (no transcript): ${rec.filename}`);
      continue;
    }
    if (content === 'notes' && !rec.is_summary) {
      console.log(`Skipping (no summary): ${rec.filename}`);
      continue;
    }

    console.log(`Syncing: ${rec.filename} (${rec.id})...`);
    const detail = await client.getRecording(rec.id);

    // Skip if the requested content is empty
    if (content === 'transcript' && !detail.transcript) {
      console.log(`  Skipped: empty transcript`);
      continue;
    }
    if (content === 'notes' && !detail.note && !detail.summary) {
      console.log(`  Skipped: no notes or summary`);
      continue;
    }

    const sections: string[] = [
      '---',
      `plaud_id: ${rec.id}`,
      `title: "${rec.filename}"`,
      `date: ${date}`,
      `duration: ${Math.round(rec.duration / 60000)}m`,
      `source: plaud`,
      `content_type: ${content}`,
      `has_transcript: ${detail.transcript.length > 0}`,
      `has_summary: ${detail.summary.length > 0}`,
      '---',
      '',
      `# ${rec.filename}`,
    ];

    if (content === 'all' || content === 'notes') {
      if (detail.outline) {
        sections.push('', '## Outline', '', detail.outline);
      }
      if (detail.note) {
        sections.push('', '## Notes', '', detail.note);
      } else if (detail.summary) {
        sections.push('', '## Summary', '', detail.summary);
      }
    }

    if (content === 'all' || content === 'transcript') {
      if (detail.transcript) {
        if (content === 'transcript') {
          // Transcript-only mode: no section header needed
          sections.push('', detail.transcript);
        } else {
          sections.push('', '## Transcript', '', detail.transcript);
        }
      } else {
        sections.push('', '*(No transcript available)*');
      }
    }

    fs.writeFileSync(mdFile, sections.join('\n'));
    synced++;
  }

  console.log(synced > 0 ? `Synced ${synced} new recording(s).` : 'Already up to date.');
}
