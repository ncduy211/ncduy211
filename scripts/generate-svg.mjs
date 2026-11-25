import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function calcUptime(birthdayStr) {
  const birth = new Date(`${birthdayStr}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  let months = now.getUTCMonth() - birth.getUTCMonth();
  let days = now.getUTCDate() - birth.getUTCDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years} years, ${months} months, ${days} days`;
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-US');
}

async function fetchLiveGitHubStats(username, fallbackStats) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!process.argv.includes('--live') && !token) {
    return fallbackStats;
  }
  if (!username || username === 'YOUR_GITHUB_USERNAME') {
    return fallbackStats;
  }

  try {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'github-neofetch-profile'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
    if (!userRes.ok) throw new Error(`GitHub user API returned ${userRes.status}`);
    const userJson = await userRes.json();

    let stars = 0;
    let page = 1;
    while (page <= 5) {
      const reposRes = await fetch(
        `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}`,
        { headers }
      );
      if (!reposRes.ok) break;
      const repos = await reposRes.json();
      if (!Array.isArray(repos) || repos.length === 0) break;
      for (const r of repos) stars += r.stargazers_count || 0;
      if (repos.length < 100) break;
      page++;
    }

    let commits = fallbackStats.commits;
    let contributed = fallbackStats.contributed;
    if (token) {
      const gqlRes = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($login: String!) {
            user(login: $login) {
              repositoriesContributedTo(contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }
              contributionsCollection { totalCommitContributions restrictedContributionsCount }
            }
          }`,
          variables: { login: username }
        })
      });
      if (gqlRes.ok) {
        const gql = await gqlRes.json();
        const u = gql?.data?.user;
        if (u) {
          contributed = (userJson.public_repos || 0) + (u.repositoriesContributedTo?.totalCount || 0);
          const cc = u.contributionsCollection;
          if (cc) {
            commits = (cc.totalCommitContributions || 0) + (cc.restrictedContributionsCount || 0);
          }
        }
      }
    }

    return {
      ...fallbackStats,
      repos: userJson.public_repos ?? fallbackStats.repos,
      followers: userJson.followers ?? fallbackStats.followers,
      stars,
      commits,
      contributed
    };
  } catch (err) {
    console.warn('Warning: Using fallback stats from config.json:', err.message);
    return fallbackStats;
  }
}

function buildRightLines(config, stats, widthCols = 60) {
  const uptime = calcUptime(config.birthday || '2002-01-01');
  const rows = [];

  const title = config.title || `${config.username}@github`;
  const topDashes = '—'.repeat(Math.max(2, widthCols - title.length - 1));
  rows.push({ type: 'title', title, dashes: topDashes });

  for (const section of config.sections) {
    if (section.header) {
      rows.push({ type: 'blank' });
      const prefix = '— ';
      const suffix = ' ' + '—'.repeat(Math.max(2, widthCols - prefix.length - section.header.length - 1));
      rows.push({ type: 'section', prefix, header: section.header, dashes: suffix });
    }

    for (const item of section.items) {
      if (item.spacer) {
        rows.push({ type: 'dotOnly' });
        continue;
      }
      const val = String(item.value).replace('{{UPTIME}}', uptime);
      const leftLen = 2 + item.key.length + 2;
      const rightLen = 1 + val.length;
      const dots = '.'.repeat(Math.max(2, widthCols - leftLen - rightLen));
      rows.push({ type: 'kv', key: item.key, dots, value: val });
    }
  }

  rows.push({ type: 'blank' });
  const gsHeader = 'GitHub Stats';
  const gsSuffix = ' ' + '—'.repeat(Math.max(2, widthCols - 3 - gsHeader.length));
  rows.push({ type: 'section', prefix: '— ', header: gsHeader, dashes: gsSuffix });

  const reposVal = fmtNum(stats.repos);
  const contribVal = fmtNum(stats.contributed);
  const starsVal = fmtNum(stats.stars);
  const leftColWidth = 35;
  const r1FixedLen = 2 + 'Repos: '.length + 1 + reposVal.length + ' {Contributed: '.length + contribVal.length + '}'.length;
  const r1Dots = '.'.repeat(Math.max(2, leftColWidth - r1FixedLen));
  const r1RightWidth = widthCols - leftColWidth - 3;
  const r1StarsFixed = 'Stars: '.length + 1 + starsVal.length;
  const r1StarsDots = '.'.repeat(Math.max(2, r1RightWidth - r1StarsFixed));
  rows.push({ type: 'stats1', r1Dots, reposVal, contribVal, r1StarsDots, starsVal });

  const commitsVal = fmtNum(stats.commits);
  const followersVal = fmtNum(stats.followers);
  const r2FixedLen = 2 + 'Commits: '.length + 1 + commitsVal.length;
  const r2Dots = '.'.repeat(Math.max(2, leftColWidth - r2FixedLen));
  const r2FollFixed = 'Followers: '.length + 1 + followersVal.length;
  const r2FollDots = '.'.repeat(Math.max(2, r1RightWidth - r2FollFixed));
  rows.push({ type: 'stats2', r2Dots, commitsVal, r2FollDots, followersVal });

  const locVal = fmtNum(stats.loc);
  const addVal = `${fmtNum(stats.locAdded)}++`;
  const delVal = `${fmtNum(stats.locDeleted)}--`;
  const r3Base = `. Lines of Code on GitHub: ${locVal} ( ${addVal}, ${delVal} )`;
  const extraSpaces = Math.max(1, widthCols - r3Base.length + 2);
  const padInParen = ' '.repeat(Math.floor(extraSpaces / 2));
  const padAfterComma = ' '.repeat(Math.max(1, extraSpaces - padInParen.length));
  rows.push({ type: 'stats3', locVal, addVal, delVal, padInParen, padAfterComma });

  return rows;
}

function renderRightRowTspans(row) {
  switch (row.type) {
    case 'blank':
      return '';
    case 'dotOnly':
      return `<tspan class="muted">.</tspan>`;
    case 'title':
      return `<tspan class="header">${escapeXml(row.title)}</tspan> <tspan class="muted">${escapeXml(row.dashes)}</tspan>`;
    case 'section':
      return `<tspan class="muted">${escapeXml(row.prefix)}</tspan><tspan class="header">${escapeXml(row.header)}</tspan><tspan class="muted">${escapeXml(row.dashes)}</tspan>`;
    case 'kv':
      return `<tspan class="muted">. </tspan><tspan class="key">${escapeXml(row.key)}:</tspan> <tspan class="muted">${escapeXml(row.dots)}</tspan> <tspan class="val">${escapeXml(row.value)}</tspan>`;
    case 'stats1':
      return `<tspan class="muted">. </tspan><tspan class="key">Repos:</tspan> <tspan class="muted">${escapeXml(row.r1Dots)}</tspan> <tspan class="val">${escapeXml(row.reposVal)}</tspan> <tspan class="muted">{</tspan><tspan class="key">Contributed:</tspan> <tspan class="val">${escapeXml(row.contribVal)}</tspan><tspan class="muted">} | </tspan><tspan class="key">Stars:</tspan> <tspan class="muted">${escapeXml(row.r1StarsDots)}</tspan> <tspan class="val">${escapeXml(row.starsVal)}</tspan>`;
    case 'stats2':
      return `<tspan class="muted">. </tspan><tspan class="key">Commits:</tspan> <tspan class="muted">${escapeXml(row.r2Dots)}</tspan> <tspan class="val">${escapeXml(row.commitsVal)}</tspan><tspan class="muted"> | </tspan><tspan class="key">Followers:</tspan> <tspan class="muted">${escapeXml(row.r2FollDots)}</tspan> <tspan class="val">${escapeXml(row.followersVal)}</tspan>`;
    case 'stats3':
      return `<tspan class="muted">. </tspan><tspan class="key">Lines of Code on GitHub:</tspan> <tspan class="val">${escapeXml(row.locVal)}</tspan><tspan class="muted"> (${escapeXml(row.padInParen)}</tspan><tspan class="add">${escapeXml(row.addVal)}</tspan><tspan class="muted">,${escapeXml(row.padAfterComma)}</tspan><tspan class="del">${escapeXml(row.delVal)}</tspan><tspan class="muted"> )</tspan>`;
    default:
      return '';
  }
}

function buildDarkSvg(asciiLines, rightRows, widthCols) {
  const theme = {
    bg: '#161b22',
    border: '#30363d',
    ascii: '#c9d1d9',
    header: '#e6edf3',
    key: '#ffa657',
    val: '#a5d6ff',
    muted: '#6e7681',
    add: '#3fb950',
    del: '#f85149'
  };

  const fontSize = 14;
  const lineHeight = 18;
  const padX = 26;
  const padY = 28;
  const asciiX = padX;
  const rightX = 355;
  const svgWidth = Math.ceil(rightX + widthCols * 7.7 + padX);

  const totalRows = Math.max(asciiLines.length, rightRows.length);
  const svgHeight = padY * 2 + totalRows * lineHeight + 6;
  const asciiStartRow = Math.floor((totalRows - asciiLines.length) / 2);
  const rightStartRow = Math.floor((totalRows - rightRows.length) / 2);

  let asciiEls = '';
  for (let i = 0; i < asciiLines.length; i++) {
    const y = padY + (asciiStartRow + i) * lineHeight + fontSize;
    asciiEls += `    <text x="${asciiX}" y="${y}" xml:space="preserve">${escapeXml(asciiLines[i])}</text>\n`;
  }

  let rightEls = '';
  for (let i = 0; i < rightRows.length; i++) {
    const content = renderRightRowTspans(rightRows[i]);
    if (!content) continue;
    const y = padY + (rightStartRow + i) * lineHeight + fontSize;
    rightEls += `    <text x="${rightX}" y="${y}" xml:space="preserve">${content}</text>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <style>
    .card {
      fill: ${theme.bg};
      stroke: ${theme.border};
      stroke-width: 1px;
    }
    .terminal {
      font-family: Consolas, 'JetBrains Mono', 'Fira Code', 'Liberation Mono', 'Courier New', monospace;
      font-size: ${fontSize}px;
      font-variant-ligatures: none;
    }
    .ascii {
      fill: ${theme.ascii};
    }
    .header {
      fill: ${theme.header};
      font-weight: 600;
    }
    .key {
      fill: ${theme.key};
    }
    .val {
      fill: ${theme.val};
    }
    .muted {
      fill: ${theme.muted};
    }
    .add {
      fill: ${theme.add};
    }
    .del {
      fill: ${theme.del};
    }
  </style>
  <rect class="card" x="0.5" y="0.5" width="${svgWidth - 1}" height="${svgHeight - 1}" rx="14" ry="14"/>
  <g class="terminal ascii">
${asciiEls}  </g>
  <g class="terminal">
${rightEls}  </g>
</svg>
`;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const asciiLines = fs.readFileSync(path.join(ROOT, 'ascii_portrait.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  while (asciiLines.length > 0 && asciiLines[asciiLines.length - 1].trim() === '') {
    asciiLines.pop();
  }

  const stats = await fetchLiveGitHubStats(config.username, config.stats);

  // Auto-fit widthCols so the longest key-value line always has at least 3 dots and aligns flush
  let minNeededCols = 60;
  for (const section of config.sections) {
    for (const item of section.items) {
      if (item.spacer) continue;
      const val = String(item.value).replace('{{UPTIME}}', calcUptime(config.birthday || '2002-01-01'));
      const needed = 2 + item.key.length + 2 + 3 + 1 + val.length;
      if (needed > minNeededCols) minNeededCols = needed;
    }
  }
  const rightRows = buildRightLines(config, stats, minNeededCols);
  const darkSvg = buildDarkSvg(asciiLines, rightRows, minNeededCols);

  fs.writeFileSync(path.join(ROOT, 'dark_mode.svg'), darkSvg, 'utf8');
  console.log('Generated dark_mode.svg successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
