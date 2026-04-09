import { PlaudAuth } from './auth.js';
import { BASE_URLS } from './types.js';
import type { PlaudRecording, PlaudRecordingDetail, PlaudUserInfo, PlaudTranscriptEntry } from './types.js';
import { gunzipSync } from 'zlib';

export class PlaudClient {
  private auth: PlaudAuth;
  private region: string;

  constructor(auth: PlaudAuth, region: string = 'us') {
    this.auth = auth;
    this.region = region;
  }

  private get baseUrl(): string {
    return BASE_URLS[this.region] ?? BASE_URLS['us'];
  }

  private async request(path: string, options?: RequestInit): Promise<any> {
    const token = await this.auth.getToken();
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`Plaud API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Handle region mismatch
    if (data?.status === -302 && data?.data?.domains?.api) {
      const domain: string = data.data.domains.api;
      this.region = domain.includes('euc1') ? 'eu' : 'us';
      return this.request(path, options);
    }

    return data;
  }

  async listRecordings(): Promise<PlaudRecording[]> {
    const data = await this.request('/file/simple/web');
    const list: PlaudRecording[] = data.data_file_list ?? data.data ?? [];
    return list.filter(r => !r.is_trash);
  }

  /**
   * Fetch a pre-signed S3 link (no auth header) and gunzip if needed.
   */
  private async fetchContentLink(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return gunzipSync(buf).toString('utf-8');
    } catch {
      return buf.toString('utf-8');
    }
  }

  async getRecording(id: string): Promise<PlaudRecordingDetail> {
    const data = await this.request(`/file/detail/${id}`);
    const raw = data.data ?? data;

    // Legacy: get note from pre_download_content_list
    let note = '';
    const preDownload: any[] = raw.pre_download_content_list ?? [];
    for (const item of preDownload) {
      const content = item.data_content ?? '';
      if (content.length > note.length) note = content;
    }

    // Fetch content from S3 links in content_list
    let rawTranscript: PlaudTranscriptEntry[] = [];
    let transcript = '';
    let outline = '';
    let summary = '';

    const contentList: any[] = raw.content_list ?? [];
    for (const item of contentList) {
      if (!item.data_link || item.task_status !== 1) continue;

      try {
        const text = await this.fetchContentLink(item.data_link);
        if (!text) continue;

        switch (item.data_type) {
          case 'transaction': {
            rawTranscript = JSON.parse(text) as PlaudTranscriptEntry[];
            // Format as readable transcript
            transcript = rawTranscript.map(entry => {
              const mins = Math.floor(entry.start_time / 60000);
              const secs = Math.floor((entry.start_time % 60000) / 1000);
              const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              return `[${ts}] ${entry.speaker}: ${entry.content}`;
            }).join('\n');
            break;
          }
          case 'outline': {
            const entries = JSON.parse(text) as any[];
            outline = entries.map(e => {
              const mins = Math.floor(e.start_time / 60000);
              const secs = Math.floor((e.start_time % 60000) / 1000);
              return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} ${e.topic}`;
            }).join('\n');
            break;
          }
          case 'auto_sum_note':
            summary = text;
            break;
          case 'consumer_note':
            if (text.length > note.length) note = text;
            break;
        }
      } catch {
        // Skip failed content fetches
      }
    }

    return {
      ...raw,
      id: raw.file_id ?? id,
      filename: raw.file_name ?? raw.filename ?? id,
      transcript,
      rawTranscript,
      outline,
      summary,
      note,
    } as PlaudRecordingDetail;
  }

  async getUserInfo(): Promise<PlaudUserInfo> {
    const data = await this.request('/user/me');
    const user = data.data_user ?? data.data ?? data;
    return {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      country: user.country,
      membership_type: data.data_state?.membership_type ?? 'unknown',
    };
  }

  async downloadAudio(id: string): Promise<ArrayBuffer> {
    const token = await this.auth.getToken();
    const res = await fetch(`${this.baseUrl}/file/download/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.arrayBuffer();
  }

  async getMp3Url(id: string): Promise<string | null> {
    try {
      const data = await this.request(`/file/temp-url/${id}?is_opus=false`);
      return data?.url ?? data?.data?.url ?? data?.data ?? data?.temp_url ?? null;
    } catch {
      return null;
    }
  }
}
