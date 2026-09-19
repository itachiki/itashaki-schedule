(() => {
  'use strict';

  const TIME_ZONE = 'Asia/Tokyo';
  const INITIAL_FILTER = 'next7';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const DEFAULT_THUMBNAIL_URL = 'assets/images/default-stream-thumbnail.jpg';
  const STREAM_BREAK_THUMBNAIL_URL = 'assets/images/stream-break-thumbnail.jpg?v=2';
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
  const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ja-JP', { timeZone: TIME_ZONE, weekday: 'short' });

  const list = document.querySelector('#schedule-list');
  const message = document.querySelector('#schedule-message');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const noticesPanel = document.querySelector('.notices');
  const noticesList = document.querySelector('.notices-list');
  let schedules = [];
  let activeFilter = INITIAL_FILTER;

  function tokyoParts(date) {
    const parts = Object.fromEntries(DATE_PARTS_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]));
    return parts;
  }

  function tokyoDateKey(date) {
    const { year, month, day } = tokyoParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dateKeyToUtcMs(key) {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  function shiftDateKey(key, days) {
    const shifted = new Date(dateKeyToUtcMs(key) + days * 86400000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  }

  function weekRange(now) {
    const today = tokyoDateKey(now);
    const dayOfWeek = new Date(dateKeyToUtcMs(today)).getUTCDay();
    const start = shiftDateKey(today, -dayOfWeek);
    return { start, end: shiftDateKey(start, 6) };
  }

  function formatDate(start) {
    const { year, month, day } = tokyoParts(start);
    return { year, label: `${month}/${day}`, weekday: WEEKDAY_FORMATTER.format(start) };
  }

  function formatTimeRange(start, end) {
    const startParts = tokyoParts(start);
    const startLabel = `${String(startParts.hour).padStart(2, '0')}:${String(startParts.minute).padStart(2, '0')}`;
    if (start.getTime() === end.getTime()) return startLabel;
    const endParts = tokyoParts(end);
    const startKey = tokyoDateKey(start);
    const endKey = tokyoDateKey(end);
    if (startKey !== endKey && end.getTime() - start.getTime() >= TWELVE_HOURS_MS) {
      const endDate = formatDate(end);
      const endYear = endDate.year !== startParts.year ? `${endDate.year}年` : '';
      const endTime = `${String(endParts.hour).padStart(2, '0')}:${String(endParts.minute).padStart(2, '0')}`;
      return `${startLabel} ～ ${endYear}${endDate.label}（${endDate.weekday}） ${endTime}`;
    }
    const daysAfterStart = Math.round((dateKeyToUtcMs(endKey) - dateKeyToUtcMs(startKey)) / 86400000);
    const endHour = endParts.hour + Math.max(0, daysAfterStart) * 24;
    return `${startLabel} ～ ${String(endHour).padStart(2, '0')}:${String(endParts.minute).padStart(2, '0')}`;
  }

  function getStatus(schedule, now) {
    if (now.getTime() < schedule.start.getTime()) return 'UPCOMING';
    if (now.getTime() < schedule.end.getTime()) return 'LIVE';
    return 'ENDED';
  }

  function youtubeVideoFromUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
      let videoId = '';
      if (url.hostname.toLowerCase().endsWith('youtu.be')) {
        videoId = url.pathname.split('/').filter(Boolean)[0] || '';
      } else if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else {
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'live') videoId = pathParts[1] || '';
      }
      return YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? { url: url.href, videoId } : null;
    } catch {
      return null;
    }
  }

  function extractYouTubeVideo(...values) {
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const candidates = value.match(/https:\/\/[^\s<>"']+/gi) || [];
      for (const candidate of candidates) {
        const cleaned = candidate.replace(/[\])}>,.!?;:、。！？；：]+$/u, '');
        const video = youtubeVideoFromUrl(cleaned);
        if (video) return video;
      }
    }
    return null;
  }

  function validHttpsUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function validOfficialThumbnailUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isOfficialHost = host === 'finalfantasyxiv.com' || host.endsWith('.finalfantasyxiv.com');
      return url.protocol === 'https:' && isOfficialHost && !url.username && !url.password && !url.port ? url.href : '';
    } catch {
      return '';
    }
  }

  function normaliseSchedule(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('予定データがオブジェクトではありません。');
    if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error('id が不足しています。');
    const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '配信';
    const enteredTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!enteredTitle && !isStreamBreakCategory(category)) throw new Error(`${raw.id}: title が不足しています。`);
    const title = enteredTitle || '本配信休み';
    if (typeof raw.start !== 'string' || typeof raw.end !== 'string') throw new Error(`${raw.id}: start または end が不足しています。`);
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw.start) || !/(Z|[+-]\d{2}:\d{2})$/i.test(raw.end)) {
      throw new Error(`${raw.id}: start と end はタイムゾーン付きISO日時で指定してください。`);
    }
    const start = new Date(raw.start);
    const end = new Date(raw.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error(`${raw.id}: 日時の形式または開始・終了時刻が不正です。`);
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
    const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? new Date(raw.updatedAt) : null;
    const youtubeVideo = extractYouTubeVideo(raw.youtubeUrl, description, content, raw.title);
    const linkUrl = isStreamBreakCategory(category)
      ? ''
      : isOfficialCategory(category)
        ? validHttpsUrl(raw.youtubeUrl) || youtubeVideo?.url || ''
        : youtubeVideo?.url || '';
    return {
      id: raw.id, title, start, end,
      category,
      content,
      description,
      linkUrl,
      youtubeVideo,
      officialThumbnailUrl: isOfficialCategory(category) ? validOfficialThumbnailUrl(raw.officialThumbnailUrl) : '',
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null
    };
  }

  function formatUpdatedAt(date) {
    const { year, month, day, hour, minute } = tokyoParts(date);
    return `${year}/${month}/${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function categoryClassName(category) {
    if (category === '本配信') return 'category category-main';
    if (isStreamBreakCategory(category)) return 'category category-break';
    if (category === '突発配信') return 'category category-special';
    if (isOfficialCategory(category)) return 'category category-official';
    return 'category';
  }

  function categoryThemeClassName(category) {
    if (category === '本配信') return 'category-theme-main';
    if (isStreamBreakCategory(category)) return 'category-theme-break';
    if (category === '突発配信') return 'category-theme-special';
    if (isOfficialCategory(category)) return 'category-theme-official';
    return 'category-theme-default';
  }

  function isOfficialCategory(category) {
    return category === 'FF14公式' || category === 'FF公式';
  }

  function isStreamBreakCategory(category) {
    return category === '本配信休み';
  }

  function shouldDisplayTime(category) {
    return !isStreamBreakCategory(category);
  }

  function shouldDisplayTitle(category) {
    return !isStreamBreakCategory(category);
  }

  function createThumbnail(schedule, eagerLoad = false) {
    const isStreamBreak = isStreamBreakCategory(schedule.category);
    const image = document.createElement('img');
    image.className = 'schedule-thumbnail';
    image.width = 1280;
    image.height = 720;
    image.loading = eagerLoad ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.alt = isStreamBreak
      ? `${schedule.title}の配信休みサムネイル`
      : schedule.youtubeVideo
        ? `${schedule.title}のYouTubeサムネイル`
        : '配信枠未設定の仮サムネイル';

    if (isStreamBreak) {
      image.src = STREAM_BREAK_THUMBNAIL_URL;
      image.dataset.fallbackStage = 'stream-break';
    } else if (schedule.youtubeVideo) {
      image.src = `https://i.ytimg.com/vi/${schedule.youtubeVideo.videoId}/maxresdefault.jpg`;
      image.dataset.fallbackStage = 'maxres';
      image.addEventListener('error', () => {
        if (image.dataset.fallbackStage === 'maxres') {
          image.dataset.fallbackStage = 'hq';
          image.src = `https://i.ytimg.com/vi/${schedule.youtubeVideo.videoId}/hqdefault.jpg`;
        } else if (image.dataset.fallbackStage === 'hq') {
          image.dataset.fallbackStage = 'default';
          image.src = DEFAULT_THUMBNAIL_URL;
        }
      });
    } else {
      image.src = DEFAULT_THUMBNAIL_URL;
      image.dataset.fallbackStage = 'default';
    }

    const linksToYouTube = !isStreamBreak && schedule.youtubeVideo;
    const frame = document.createElement(linksToYouTube ? 'a' : 'div');
    frame.className = `thumbnail-frame${linksToYouTube ? ' thumbnail-link' : ''}`;
    if (linksToYouTube) {
      frame.href = schedule.youtubeVideo.url;
      frame.target = '_blank';
      frame.rel = 'noopener noreferrer';
      frame.setAttribute('aria-label', `${schedule.title}のYouTube配信ページを開く（新しいタブ）`);
    }
    frame.append(image);
    return frame;
  }

  function createOfficialThumbnail(schedule, eagerLoad = false) {
    if (!schedule.officialThumbnailUrl || !schedule.linkUrl) return null;
    const frame = document.createElement('a');
    frame.className = 'thumbnail-frame thumbnail-link official-thumbnail-frame';
    frame.href = schedule.linkUrl;
    frame.target = '_blank';
    frame.rel = 'noopener noreferrer';
    frame.setAttribute('aria-label', `${schedule.title}のFF14公式ページを開く（新しいタブ）`);

    const image = document.createElement('img');
    image.className = 'schedule-thumbnail official-thumbnail';
    image.src = schedule.officialThumbnailUrl;
    image.width = 1200;
    image.height = 630;
    image.loading = eagerLoad ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.alt = `${schedule.title}のFF14公式画像`;
    image.addEventListener('error', () => frame.remove(), { once: true });
    frame.append(image);
    return frame;
  }

  function hasDisplayThumbnail(schedule) {
    return isOfficialCategory(schedule.category)
      ? Boolean(schedule.officialThumbnailUrl && schedule.linkUrl)
      : true;
  }

  function createCard(schedule, status, thumbnailIndex) {
    const statusText = { UPCOMING: '配信予定', LIVE: '配信中', ENDED: 'アーカイブ' }[status];
    const isOfficial = isOfficialCategory(schedule.category);
    const isStreamBreak = isStreamBreakCategory(schedule.category);
    const card = document.createElement('article');
    card.className = 'schedule-card';
    card.classList.add(categoryThemeClassName(schedule.category));
    if (isOfficial) card.classList.add('is-official');
    else if (!isStreamBreak && status === 'LIVE') card.classList.add('is-live');
    const cardLabel = isOfficial
      ? `${schedule.title}、FF14公式情報${status === 'LIVE' ? '、実施中' : ''}`
      : isStreamBreak
        ? `${schedule.title}、本配信休み`
        : `${schedule.title}、${statusText}`;
    card.setAttribute('aria-label', cardLabel);
    const thumbnail = isOfficial
      ? createOfficialThumbnail(schedule, thumbnailIndex < 2)
      : createThumbnail(schedule, thumbnailIndex < 2);
    if (thumbnail) {
      card.classList.add('has-thumbnail');
      card.append(thumbnail);
    }
    const summary = document.createElement('div');
    summary.className = 'card-summary';
    const formattedDate = formatDate(schedule.start);
    const date = createTextElement('p', 'date', '');
    date.append(createTextElement('span', 'year', `${formattedDate.year}年`));
    date.append(document.createTextNode(formattedDate.label));
    const weekday = createTextElement('span', 'weekday', `（${formattedDate.weekday}）`);
    date.append(weekday);
    summary.append(date);
    if (shouldDisplayTime(schedule.category)) {
      summary.append(createTextElement('p', 'time', formatTimeRange(schedule.start, schedule.end)));
    }
    if (shouldDisplayTitle(schedule.category)) {
      summary.append(createTextElement('h3', 'title', schedule.title));
    }
    const top = document.createElement('div');
    top.className = 'card-top';
    top.append(createTextElement('p', categoryClassName(schedule.category), schedule.category));
    if (!isStreamBreak && isOfficial && status === 'LIVE') {
      top.append(createTextElement('p', 'status status-official-active', '実施中'));
    } else if (!isStreamBreak && !isOfficial) {
      const statusClass = { UPCOMING: 'status-upcoming', LIVE: 'status-live', ENDED: 'status-archive' }[status];
      top.append(createTextElement('p', `status ${statusClass}`, statusText));
    }
    summary.append(top);
    const details = document.createElement('div');
    details.className = 'card-details';
    if (schedule.content) details.append(createTextElement('p', 'content-name', schedule.content));
    if (schedule.description) details.append(createTextElement('p', 'description', schedule.description));
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    if (schedule.linkUrl) {
      const link = document.createElement('a');
      link.className = `youtube-link${isOfficial ? ' official-link' : ''}`;
      link.href = schedule.linkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const linkText = isOfficial ? '公式情報を見る' : 'YouTubeで見る';
      link.textContent = linkText;
      link.setAttribute('aria-label', isOfficial
        ? `${schedule.title}の公式情報を見る（新しいタブで開く）`
        : `${schedule.title}をYouTubeで見る（新しいタブで開く）`);
      footer.append(link);
    }
    if (schedule.updatedAt) {
      footer.append(createTextElement('p', 'updated-at', `更新：${formatUpdatedAt(schedule.updatedAt)}`));
    }
    details.append(footer);
    card.append(summary, details);
    return card;
  }

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `schedule-message${kind ? ` is-${kind}` : ''}`;
  }

  function renderNotices(notices) {
    noticesList.replaceChildren();
    noticesPanel.hidden = notices.length === 0;
    notices.forEach((notice) => {
      const item = document.createElement('li');
      if (notice.heading) {
        const heading = createTextElement('strong', 'notice-item-title', notice.heading);
        item.append(heading, document.createTextNode('：'));
      }
      item.append(document.createTextNode(notice.body));
      noticesList.append(item);
    });
  }

  async function loadNotices() {
    try {
      const response = await fetch('/api/notices', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('お知らせAPIのレスポンスが配列ではありません。');
      const notices = data.map((notice) => ({
        heading: typeof notice?.heading === 'string' ? notice.heading.trim() : '',
        body: typeof notice?.body === 'string' ? notice.body.trim() : ''
      })).filter((notice) => notice.body);
      renderNotices(notices);
    } catch (error) {
      console.warn('お知らせAPIを読み込めないため、固定のお知らせを表示します:', error);
    }
  }

  function isWithinFilter(schedule, filter, now) {
    if (getStatus(schedule, now) === 'LIVE') return true;
    const startKey = tokyoDateKey(schedule.start);
    if (filter === 'today') return startKey === tokyoDateKey(now);
    if (filter === 'week') {
      const range = weekRange(now);
      return startKey >= range.start && startKey <= range.end;
    }
    if (filter === 'next7') {
      const startTime = schedule.start.getTime();
      return startTime >= now.getTime() && startTime <= now.getTime() + SEVEN_DAYS_MS;
    }
    return getStatus(schedule, now) !== 'ENDED';
  }

  function render() {
    const now = new Date();
    const visible = schedules.filter((schedule) => isWithinFilter(schedule, activeFilter, now));
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    if (!visible.length) {
      setMessage('この期間に表示できる配信予定はありません。', 'empty');
      return;
    }
    setMessage('');
    let thumbnailIndex = 0;
    visible.forEach((schedule) => {
      list.append(createCard(schedule, getStatus(schedule, now), thumbnailIndex));
      if (hasDisplayThumbnail(schedule)) thumbnailIndex += 1;
    });
  }

  function setFilter(filter) {
    activeFilter = filter;
    filters.forEach((button) => {
      const selected = button.dataset.filter === filter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    render();
  }

  async function loadSchedules() {
    try {
      const response = await fetch('/api/schedules', { cache: 'no-store' });
      if (!response.ok) {
        let detail = '';
        try {
          const errorData = await response.json();
          detail = typeof errorData.detail === 'string' ? errorData.detail : '';
        } catch {
          // JSON以外のエラーレスポンスでは共通メッセージを使用する。
        }
        throw new Error(detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('配信予定APIのレスポンスが配列ではありません。');
      schedules = data.map(normaliseSchedule).sort((a, b) => a.start - b.start);
      setFilter(INITIAL_FILTER);
    } catch (error) {
      list.replaceChildren();
      list.setAttribute('aria-busy', 'false');
      const detail = /^\d+行目/.test(error?.message || '') ? ` ${error.message}` : '';
      setMessage(`配信予定を読み込めませんでした。${detail || ' 時間をおいて再読み込みしてください。'}`, 'error');
      console.error('配信予定APIの読み込みまたは形式のエラー:', error);
    }
  }

  filters.forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  loadNotices();
  loadSchedules();
  window.setInterval(render, 30000);
})();
