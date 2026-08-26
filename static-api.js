/* Browser-side replacement for EventScope's frozen /api/* endpoints. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const base = new URL('./', document.currentScript.src);
  const dataVersion = '20260826-deduped-invalid-mentions-v1';
  const jsonCache = new Map();
  const bucketCache = new Map();
  const scanCache = new Map();
  let manifestPromise;

  function assetUrl(relative) {
    const url = new URL(relative, base);
    url.searchParams.set('v', dataVersion);
    return url;
  }

  async function gzipJson(relative) {
    if (jsonCache.has(relative)) return jsonCache.get(relative);
    const promise = (async () => {
      const response = await nativeFetch(assetUrl(relative));
      if (!response.ok) throw new Error(`静态数据读取失败：${relative}`);
      if (!('DecompressionStream' in window)) throw new Error('浏览器版本过旧，不支持冻结数据解压');
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).json();
    })();
    jsonCache.set(relative, promise);
    try { return await promise; }
    catch (error) { jsonCache.delete(relative); throw error; }
  }

  function manifest() {
    return manifestPromise ||= nativeFetch(assetUrl('static-data/manifest.json')).then(response => {
      if (!response.ok) throw new Error('冻结数据清单读取失败');
      return response.json();
    });
  }

  function utf8Hash(text) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(String(text))) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  async function lookup(group, identity) {
    const m = await manifest();
    let spec = m.details[group];
    if (!spec) return null;
    if (spec.alias) return lookup(spec.alias, identity);
    const bucket = utf8Hash(identity) % spec.buckets;
    const relative = spec.path.replace('{bucket}', String(bucket).padStart(3, '0'));
    let values = bucketCache.get(relative);
    if (!values) {
      values = gzipJson(relative);
      bucketCache.set(relative, values);
    }
    return (await values)[identity] ?? null;
  }

  function clean(item) {
    const value = {...item};
    for (const key of Object.keys(value)) if (key.startsWith('__')) delete value[key];
    return value;
  }

  function intParam(params, name, fallback, low, high) {
    const value = Number.parseInt(params.get(name) || fallback, 10);
    return Math.max(low, Math.min(high, Number.isFinite(value) ? value : fallback));
  }

  function requestedState(kind, params) {
    if (kind === 'routes') return params.get('status') || 'all';
    if (kind === 'mentions') return params.get('valid') || 'all';
    return params.get('state') || 'all';
  }

  function extraMatch(item, kind, params, directState) {
    const state = requestedState(kind, params);
    if (!directState && !['all', 'filtered', 'readable'].includes(state) && String(item.__state) !== state) return false;
    if (kind === 'mentions') {
      const assertion = (params.get('assertion') || 'all').toLowerCase();
      if (assertion === 'missing' && item.__assertion) return false;
      if (!['all', 'missing'].includes(assertion) && item.__assertion !== assertion) return false;
    }
    const domain = params.get('domain') || 'all';
    if (domain !== 'all' && item.__domain !== domain) return false;
    const minimum = Number(params.get('min_publishers') || 0);
    if (minimum && Number(item.__publishers || 0) < minimum) return false;
    return true;
  }

  async function directPage(stateSpec, start, size) {
    if (start >= stateSpec.total) return [];
    const first = Math.floor(start / stateSpec.chunk_size);
    const last = Math.floor(Math.min(stateSpec.total - 1, start + size - 1) / stateSpec.chunk_size);
    const chunks = await Promise.all(stateSpec.chunks.slice(first, last + 1).map(gzipJson));
    const joined = chunks.flat();
    return joined.slice(start - first * stateSpec.chunk_size, start - first * stateSpec.chunk_size + size);
  }

  async function scanDataset(kind, spec, stateName, params) {
    const q = (params.get('q') || '').trim().toLowerCase();
    const stateSpec = spec.states[stateName] || spec.states.all;
    const directState = Boolean(spec.states[stateName]);
    const cacheKey = `${kind}|${stateName}|${q}|${params.get('assertion') || ''}|${params.get('domain') || ''}|${params.get('min_publishers') || ''}`;
    if (scanCache.has(cacheKey)) return scanCache.get(cacheKey);
    const promise = (async () => {
      const matches = [];
      for (let index = 0; index < stateSpec.chunks.length; index += 6) {
        const group = await Promise.all(stateSpec.chunks.slice(index, index + 6).map(gzipJson));
        for (const item of group.flat()) {
          if ((!q || String(item.__search || '').includes(q)) && extraMatch(item, kind, params, directState)) matches.push(item);
        }
      }
      return matches;
    })();
    scanCache.set(cacheKey, promise);
    return promise;
  }

  async function query(kind, params) {
    const m = await manifest();
    const spec = m.datasets[kind];
    if (!spec) throw Object.assign(new Error('unknown kind'), {status: 400});
    const page = intParam(params, 'page', 1, 1, 100000);
    const size = intParam(params, 'size', kind === 'routes' || kind === 'mentions' ? 24 : 18, 6, 100);
    const start = (page - 1) * size;
    const stateName = requestedState(kind, params);
    const stateSpec = spec.states[stateName] || spec.states.all;
    const q = (params.get('q') || '').trim();
    const needsScan = Boolean(q) || !spec.states[stateName] ||
      (kind === 'mentions' && (params.get('assertion') || 'all') !== 'all') ||
      (params.get('domain') || 'all') !== 'all' || Number(params.get('min_publishers') || 0) > 0;
    let items, total;
    if (needsScan) {
      const matches = await scanDataset(kind, spec, stateName, params);
      total = matches.length;
      items = matches.slice(start, start + size);
    } else {
      total = stateSpec.total;
      items = await directPage(stateSpec, start, size);
    }
    return {
      items: items.map(clean), page, size, has_more: start + items.length < total,
      total_pages: Math.max(1, Math.ceil(total / size)), is_live: false,
      showcase_priority: Boolean(spec.showcase_priority && !q && ['all', 'matched', 'true'].includes(stateName)),
      updated_at: m.updated_at,
    };
  }

  function normalizeEventCard(card) {
    if (!card) return null;
    const node = card.target_node || {};
    return {
      ...card,
      event_name: card.event_name || node.event_name,
      level: card.level ?? node.level,
      definition: card.definition || node.definition,
      inclusion_criteria: card.inclusion_criteria?.length ? card.inclusion_criteria : (node.inclusion_criteria || []),
      exclusion_criteria: card.exclusion_criteria?.length ? card.exclusion_criteria : (node.exclusion_criteria || []),
    };
  }

  async function eventCard(identity) {
    return normalizeEventCard(await lookup('events', identity));
  }

  async function article(identity) {
    const record = await lookup('articles', identity);
    if (!record) return null;
    const routed = await Promise.all((record.final_event_ids || []).map(eventCard));
    return {...record, routed_event_cards: routed.filter(Boolean).map(card => ({
      event_id: card.event_id,
      event_name: card.target_node?.event_name,
      source_path: card.source_path,
    }))};
  }

  function originalArticle(record) {
    return {
      article_file_id: record?.article_file_id,
      article_title: record?.title,
      content: record?.content,
      article_source: record?.publisher,
      article_publish_time: record?.publish_time,
    };
  }

  async function detail(kind, identity, upstream) {
    if (upstream && kind === 'events') return eventCard(identity);
    const record = await lookup(kind, identity);
    if (!record) return null;
    if (upstream && kind === 'routes') {
      const source = await article(identity);
      const cards = await Promise.all((record.final_event_ids || []).map(eventCard));
      return {...record, article: originalArticle(source), routed_event_cards: cards.filter(Boolean)};
    }
    if (upstream && kind === 'mentions') {
      const source = await article(record.article_id || record.input_row_id);
      const card = record.event_card_id ? await eventCard(record.event_card_id) : null;
      return {...record, article: originalArticle(source), event_card: card};
    }
    if (kind === 'quality') {
      const source = await article(record.input_row_id);
      return {...record, article: source};
    }
    return record;
  }

  async function dispatch(url) {
    const marker = url.pathname.indexOf('/api/');
    const path = marker >= 0 ? url.pathname.slice(marker) : url.pathname;
    const params = url.searchParams;
    if (path === '/api/showcase') return gzipJson((await manifest()).summary);
    if (path === '/api/summary') return gzipJson((await manifest()).summary_legacy);
    if (path === '/api/tree') return gzipJson((await manifest()).tree);
    if (path === '/api/article') {
      const value = await article(params.get('id') || '');
      if (!value) throw Object.assign(new Error('not found'), {status: 404});
      return value;
    }
    if (path === '/api/query') return query(params.get('kind') || '', params);
    if (path === '/api/intelligence/query') return query(params.get('kind') || '', params);
    if (path === '/api/detail' || path === '/api/intelligence/detail') {
      const value = await detail(params.get('kind') || '', params.get('id') || '', path === '/api/detail');
      if (!value) throw Object.assign(new Error('not found'), {status: 404});
      return value;
    }
    throw Object.assign(new Error('not found'), {status: 404});
  }

  window.fetch = async function frozenFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.includes('/api/')) return nativeFetch(input, init);
    try {
      const payload = await dispatch(url);
      return new Response(JSON.stringify(payload), {status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}});
    } catch (error) {
      const status = Number(error?.status || 500);
      return new Response(JSON.stringify({error: error?.message || 'static api error'}), {
        status, headers: {'Content-Type': 'application/json; charset=utf-8'},
      });
    }
  };
})();
