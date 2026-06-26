const fs = require('fs');
const path = require('path');

const LOGIN_URL = 'https://secure.xserver.ne.jp/xapanel/login/xvps/';
const VPS_INDEX_URL = 'https://secure.xserver.ne.jp/xapanel/xvps/index';
const DATA_DIR = process.env.DATA_DIR || '/data';
const PROFILE_DIR = process.env.PROFILE_DIR || path.join(DATA_DIR, 'profiles');
const RENEWAL_THRESHOLD_DAYS = Number(process.env.RENEWAL_THRESHOLD_DAYS || 1);
const HEADLESS = process.env.BROWSER_HEADLESS !== 'false';
const CAPTCHA_MODEL_URL =
  process.env.CAPTCHA_MODEL_URL ||
  'https://github30.github.io/captcha-cloudrun/web_model/model.json?v=20260407-2';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
}

function parseExpiry(text) {
  const match = String(text || '').match(/(20\d{2})\s*(?:[-/年])\s*(\d{1,2})\s*(?:[-/月])\s*(\d{1,2})/);
  if (!match) {
    return {
      success: false,
      action: 'check',
      error: `无法解析到期日: ${text || '(empty)'}`,
    };
  }

  const expiryDate = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  const todayText = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' });
  const today = new Date(`${todayText}T00:00:00+09:00`);
  const expiry = new Date(`${expiryDate}T00:00:00+09:00`);
  const daysLeft = Math.ceil((expiry - today) / 86400000);

  return {
    success: true,
    action: 'check',
    expiryDate,
    daysLeft,
    needsRenewal: daysLeft <= RENEWAL_THRESHOLD_DAYS,
    message: `到期日 ${expiryDate}, 剩余 ${daysLeft} 天`,
  };
}

async function launchAccountContext(account) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const { launchPersistentContext } = await import('cloakbrowser');
  const userDataDir = path.join(PROFILE_DIR, `${account.id}-${safeName(account.username)}`);

  return launchPersistentContext({
    userDataDir,
    headless: HEADLESS,
    humanize: true,
    timezone: 'Asia/Tokyo',
    locale: 'ja-JP',
    viewport: { width: 1366, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=ja-JP',
    ],
  });
}

async function clickFirst(page, selectors, timeout = 8000) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      try {
        await locator.click({ timeout });
        return selector;
      } catch (_) {
        // Try the next candidate.
      }
    }
  }
  return null;
}

async function login(page, username, password) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#memberid, input[name="memberid"]').first().waitFor({ timeout: 30000 });
  await page.locator('#memberid, input[name="memberid"]').first().fill(username);
  await page.locator('#user_password, input[name="user_password"]').first().fill(password);

  const clicked = await clickFirst(page, [
    'input[name="action_user_login"]',
    'button[type="submit"]',
    'input[type="submit"]',
    'text=ログイン',
    'text=ログインする',
  ]);

  if (!clicked) {
    throw new Error('找不到登录按钮');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(4000);
}

async function isLoginPage(page) {
  if (page.url().includes('/login/')) return true;
  return (await page.locator('#memberid, input[name="memberid"]').count().catch(() => 0)) > 0;
}

async function hasFreeVpsRow(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('tr')].some((row) => {
      const text = row.textContent || '';
      return (
        row.querySelector('.freeServerIco') ||
        (text.includes('無料VPS') && row.querySelector('a[href*="/xapanel/xvps/server/detail"]')) ||
        row.querySelector('a[href^="/xapanel/xvps/server/detail?id="]')
      );
    });
  }).catch(() => false);
}

async function pageSummary(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').textContent({ timeout: 10000 }).catch(() => '');
  return {
    url: page.url(),
    title,
    bodyText: bodyText.slice(0, 300).replace(/\s+/g, ' '),
  };
}

async function ensureLoggedIn(page, account) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(VPS_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    if (await hasFreeVpsRow(page)) return;

    if (await isLoginPage(page)) {
      await login(page, account.username, account.password);
      if (await hasFreeVpsRow(page)) return;

      await page.goto(VPS_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);
      if (await hasFreeVpsRow(page)) return;
    }

    await sleep(4000);
    if (await hasFreeVpsRow(page)) return;
  }

  const summary = await pageSummary(page);
  throw new Error(
    `XServer VPS page is not reachable after login. URL: ${summary.url}; title: ${summary.title}; snippet: ${summary.bodyText}`
  );

  await page.goto(VPS_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  if (!page.url().includes('/login/')) return;

  await login(page, account.username, account.password);
  await page.goto(VPS_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  if (page.url().includes('/login/')) {
    throw new Error('登录失败，账号密码可能错误，或需要人工验证');
  }
}

async function getFreeVpsInfo(page) {
  if (!(await hasFreeVpsRow(page))) {
    await page.goto(VPS_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
  }

  let info = await extractFreeVpsFromPage(page);

  if (!info) {
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').textContent({ timeout: 10000 }).catch(() => '');
    return {
      success: false,
      action: 'check',
      error: `找不到免费 VPS。页面标题: ${title}; 片段: ${bodyText.slice(0, 240).replace(/\s+/g, ' ')}`,
    };
  }

  if ((!info.expiryText || !parseExpiry(info.expiryText).success) && info.detailHref) {
    const detailUrl = new URL(info.detailHref, VPS_INDEX_URL).href;
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    info = {
      ...info,
      ...(await extractFreeVpsDetailFromPage(page)),
    };
  }

  const parsed = parseExpiry(info.expiryText);
  return { ...parsed, detailHref: info.detailHref };
}

async function extractFreeVpsFromPage(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((candidate) => {
      const text = candidate.textContent || '';
      return (
        candidate.querySelector('.freeServerIco') ||
        (text.includes('無料VPS') && candidate.querySelector('a[href*="/xapanel/xvps/server/detail"]')) ||
        candidate.querySelector('a[href^="/xapanel/xvps/server/detail?id="]')
      );
    });

    if (!row) return null;

    const detailHref =
      row.querySelector('a[href^="/xapanel/xvps/server/detail?id="]')?.getAttribute('href') ||
      row.querySelector('a[href*="/xapanel/xvps/server/detail"]')?.getAttribute('href') ||
      '';

    const explicitTerm = row.querySelector('.contract__term')?.textContent?.trim() || '';
    const dateMatches = (row.textContent || '').match(/20\d{2}\s*(?:[-/年])\s*\d{1,2}\s*(?:[-/月])\s*\d{1,2}/g) || [];

    return {
      expiryText: explicitTerm || dateMatches[dateMatches.length - 1] || '',
      detailHref,
    };
  }).catch(() => null);
}

async function extractFreeVpsDetailFromPage(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const limitRow = rows.find((row) => (row.textContent || '').includes('利用期限'));
    const expiryText =
      limitRow?.textContent?.match(/20\d{2}\s*(?:[-/年])\s*\d{1,2}\s*(?:[-/月])\s*\d{1,2}/)?.[0] ||
      '';

    return {
      expiryText,
      detailHref: location.href,
    };
  }).catch(() => ({ expiryText: '', detailHref: page.url() }));
}

async function solveCaptchaInPage(page) {
  return page.evaluate(async (modelUrl) => {
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        if (window.tf) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
        document.head.appendChild(script);
      });
    }

    function decodeCaptcha(predictionTensor) {
      const blankIndex = predictionTensor.shape[2] - 1;
      const bestPath = predictionTensor.argMax(-1).dataSync();
      const digits = [];
      let previous = blankIndex;

      for (const index of bestPath) {
        if (index !== blankIndex && index !== previous) digits.push(String(index));
        previous = index;
      }
      return digits.join('');
    }

    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    await window.tf.ready();

    const img = document.querySelector('img[src^="data:image"], img[src^="data:"]');
    if (!img) throw new Error('找不到验证码图片');

    const model = await window.tf.loadLayersModel(modelUrl);
    const code = window.tf.tidy(() => {
      const tensor = window.tf.browser
        .fromPixels(img)
        .resizeBilinear([60, 300])
        .toFloat()
        .div(255)
        .expandDims(0);
      return decodeCaptcha(model.predict(tensor));
    });

    const input =
      document.querySelector('input[name*="captcha"], input[placeholder*="画像"], input[type="text"]');
    if (!input) throw new Error('找不到验证码输入框');

    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return code;
  }, CAPTCHA_MODEL_URL);
}

async function waitForTurnstile(page, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await page.evaluate(() => {
      const field = document.querySelector('[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]');
      if (!field) return 'missing';
      return field.value ? 'ready' : 'waiting';
    }).catch(() => 'missing');

    if (status === 'missing' || status === 'ready') return status;
    await sleep(1000);
  }
  throw new Error('Cloudflare Turnstile 未在超时时间内完成');
}

async function submitRenewalFinal(page) {
  await waitForTurnstile(page);
  const clicked = await clickFirst(page, [
    'text=無料VPSの利用を継続する',
    'button:has-text("無料VPS")',
    'input[type="submit"]',
    'button[type="submit"]',
  ], 12000);

  if (!clicked) {
    throw new Error('找不到最终续期提交按钮');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(3000);
}

async function renewFreeVps(page, info) {
  if (!info.detailHref) throw new Error('找不到免费 VPS 详情链接，无法进入续期页');

  const detailUrl = new URL(info.detailHref, VPS_INDEX_URL).href;
  const renewUrl = detailUrl.replace('detail?id', 'freevps/extend/index?id_vps');

  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  const updateClicked = await clickFirst(page, [
    'text=更新する',
    'button:has-text("更新")',
    'a:has-text("更新")',
    'input[value*="更新"]',
  ], 6000);

  if (updateClicked) {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await sleep(2000);
  }

  if (!page.url().includes('/freevps/extend/')) {
    await page.goto(renewUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);
  }

  const confirmClicked = await clickFirst(page, [
    '[formaction="/xapanel/xvps/server/freevps/extend/conf"]',
    'button:has-text("確認")',
    'input[type="submit"]',
    'button[type="submit"]',
  ]);

  if (!confirmClicked) throw new Error('找不到续期确认按钮');

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(2500);

  const hasCaptcha = await page.locator('img[src^="data:image"], img[src^="data:"]').count().catch(() => 0);
  if (hasCaptcha > 0) {
    let solved = false;
    let lastError = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        await solveCaptchaInPage(page);
        solved = true;
        break;
      } catch (err) {
        lastError = err;
        await sleep(1000);
      }
    }
    if (!solved) throw lastError || new Error('验证码识别失败');
  }

  await submitRenewalFinal(page);
}

async function checkAndRenewAccount(account, options = {}) {
  const context = await launchAccountContext(account);
  const page = context.pages()[0] || await context.newPage();

  try {
    await ensureLoggedIn(page, account);
    const before = await getFreeVpsInfo(page);
    if (!before.success) return before;

    if (!before.needsRenewal) {
      return {
        ...before,
        action: 'check',
        message: `无需续期。到期日 ${before.expiryDate}, 剩余 ${before.daysLeft} 天`,
      };
    }

    if (options.renew === false) {
      return {
        ...before,
        action: 'needs_renewal',
        message: `需要续期。到期日 ${before.expiryDate}, 剩余 ${before.daysLeft} 天`,
      };
    }

    await renewFreeVps(page, before);
    const after = await getFreeVpsInfo(page);

    if (!after.success) {
      return {
        ...after,
        action: 'renew_failed',
        error: `续期后复查失败: ${after.error}`,
      };
    }

    if (after.expiryDate === before.expiryDate || after.needsRenewal) {
      return {
        success: false,
        action: 'renew_failed',
        expiryDate: after.expiryDate,
        daysLeft: after.daysLeft,
        error: `自动续期后到期日未更新。续期前 ${before.expiryDate}, 续期后 ${after.expiryDate}`,
      };
    }

    return {
      ...after,
      action: 'renewed',
      previousExpiryDate: before.expiryDate,
      message: `自动续期成功: ${before.expiryDate} -> ${after.expiryDate}`,
    };
  } catch (err) {
    return {
      success: false,
      action: 'renew_failed',
      error: err.message,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = {
  checkAndRenewAccount,
  parseExpiry,
};
