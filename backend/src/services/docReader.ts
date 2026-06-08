import axios from 'axios';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import path from 'path';
import { isFeishuUrl, readFeishuDoc } from './feishu';

// 读取普通网页正文
async function readWebPage(url: string): Promise<string> {
  const resp = await axios.get(url, {
    timeout: 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  const $ = cheerio.load(resp.data);
  // 去掉脚本、样式、导航等噪音
  $('script, style, noscript, nav, footer, header, svg, iframe').remove();
  // 优先取 article / main，否则取 body
  const main = $('article').text() || $('main').text() || $('body').text();
  return main.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// 根据链接读取内容（自动区分飞书 / 普通网页）
export async function readFromUrl(url: string): Promise<{ source: string; content: string }> {
  if (isFeishuUrl(url)) {
    const content = await readFeishuDoc(url);
    return { source: `飞书文档: ${url}`, content };
  }
  const content = await readWebPage(url);
  return { source: `网页: ${url}`, content };
}

// 解析上传的文件
export async function readFromFile(
  buffer: Buffer,
  originalName: string,
): Promise<{ source: string; content: string }> {
  const ext = path.extname(originalName).toLowerCase();
  let content = '';

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    content = result.value;
  } else if (ext === '.pdf') {
    const result = await pdfParse(buffer);
    content = result.text;
  } else if (ext === '.md' || ext === '.txt' || ext === '.markdown') {
    content = buffer.toString('utf-8');
  } else if (ext === '.doc') {
    throw new Error('暂不支持旧版 .doc 格式，请另存为 .docx 后再上传');
  } else {
    // 兜底：当作纯文本读取
    content = buffer.toString('utf-8');
  }

  return { source: `文件: ${originalName}`, content: content.trim() };
}
