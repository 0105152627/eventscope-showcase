const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const displayText = value => String(value ?? '').replace(/\bpair\b/gi, '匹配');
const esc = value => displayText(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const fmt = value => Number(value || 0).toLocaleString('zh-CN');
function scoreTransition(before, after) {
  if (before == null || after == null) return '分数变化';
  const start = Number(before);
  const end = Number(after);
  const delta = Math.abs(end - start);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '分数变化';
  // 两位小数无法体现微小变化时，自动增加位数，最多展示四位。
  const precision = delta > 0 && start.toFixed(2) === end.toFixed(2)
    ? Math.min(4, Math.max(3, Math.ceil(-Math.log10(delta)))) : 2;
  return `${start.toFixed(precision)} → ${end.toFixed(precision)}`;
}
const clip = (value, limit = 170) => {
  const text = displayText(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
const labels = {
  company:'公司级', industry:'产业级', matched:'已匹配', trash:'未形成事件', true:'有效', false:'无效',
  high:'高可信', medium:'中可信', low:'低可信', watch:'观察', insufficient_sample:'样本不足',
  confirmed:'已确认', corroborated:'多源印证', reported:'已报道', unverified:'待核验',
  positive:'正面影响', negative:'负面影响', neutral:'影响中性', uncertain:'影响尚不明确',
  fact:'事实陈述', rumor:'传闻信息', denial:'否认或澄清',
  unique_earliest_observation:'唯一最早观测', tied_earliest_observations:'最早时间并列',
  developing:'发展中', reassessing:'重新评估', resolved:'已解决',
  INVALID_CONTENT:'无效内容', NO_SCHEMA_MATCH:'未被当前事件体系覆盖', NO_EVENT:'没有形成可提取事件', INSUFFICIENT_EVIDENCE:'证据不足',
  EVENT_CARD_MISMATCH:'事件卡不匹配',
  advertising_or_promotion_only:'广告或纯推广', content_shorter_than_repost_minimum:'正文过短',
  invalid_content_by_route_review:'路由复核后判定无效', too_short_or_fragmentary_content:'正文残缺或只有来源署名',
  empty_content:'正文为空', fetch_or_page_failure:'页面抓取失败',
  reported_supported_event:'报道的事件后来得到证实', route_no_event:'报道没有形成有效事件',
  route_no_schema_match:'内容未被当前事件体系覆盖', routed_but_no_valid_event:'路由后未提取出有效事件',
  reported_low_confidence_event:'报道了低可信事件', route_invalid_content:'内容被判定为无效'
};
const textLabel = value => labels[String(value)] || String(value || '—');
const tone = value => ['high','confirmed','matched','true','increase'].includes(String(value)) ? 'good' :
  ['low','trash','false','reassessing','decrease'].includes(String(value)) ? 'bad' :
  ['medium','watch','developing'].includes(String(value)) ? 'warn' : 'info';
const chip = (value, kind = tone(value)) => `<span class="chip ${kind}">${esc(textLabel(value))}</span>`;
const icon = name => ({
  tree:'⌘', route:'↗', extract:'◇', filter:'⊘', repost:'⇢', merge:'⇥', event:'◆', media:'◉', chain:'⌁',
  check:'✓', close:'×', article:'▤', score:'◌', up:'↗', down:'↘', arrow:'→'
}[name] || '•');

const pageState = Object.fromEntries(['routing','mentions','quality','dedup','library','media','chains'].map(key => [key, {page:1, more:false, loaded:false}]));
pageState.dedup.kind = 'reposts';
let activeView = 'taxonomy';
let summary = {};
let taxonomy = [];
let mediaRecordParent = null;

const sectionGuides = {
  taxonomy: {number:'01', title:'事件体系说明', summary:'这是全流程的语义底座：每一条新闻都先在稳定、冻结的事件卡体系中找到可解释的位置。', process:['全量扫描新闻语料，逐条归纳其中可复用的通用事件。','将语义相近的通用事件持续合并、去重，并整理为公司级与产业级事件卡。','冻结事件名称、定义、纳入条件和排除条件，作为后续处理的统一标准。'], points:['按公司级、产业级和三级事件结构浏览事件卡。','每张事件卡明确给出定义、纳入条件与排除条件。','后续路由、实例提取和事件合并均以此体系为统一标准。']},
  routing: {number:'02', title:'事件路由结果说明', summary:'展示每条新闻进入哪张事件卡，或为什么没有进入有效事件流程。', process:['新闻先匹配一级事件领域，缩小候选范围。','再依次匹配二级、三级事件卡，并核对新闻与事件定义是否一致。','匹配成功进入实例提取；无事件、体系外或无效内容进入对应审计分支。'], points:['“已匹配事件”表示新闻已命中对应事件卡，可进入实例提取。','“未形成事件”与体系外内容会保留具体原因，便于审计。','点击记录可查看新闻、路由判断与候选事件信息。']},
  mentions: {number:'03', title:'事件实例说明', summary:'系统从已路由新闻中抽取可计算的事件事实，并保留结构化证据。', process:['对已路由新闻逐条提取主体、事件事实、时间、影响方向与断言状态。','将抽取结果与命中的事件卡进行匹配复核，排除不一致的组合。','通过复核的有效实例成为去重、聚合和可信度计算的输入。'], points:['抽取主体、事件事实、时间、影响方向和断言状态等字段。','有效实例会进入后续的去重、聚合与可信度评估。','详情可查看对应新闻的 ID、标题与正文。']},
  quality: {number:'04', title:'事件过滤结果说明', summary:'低质量、无效或证据不足的内容不会静默丢弃，而是形成可回溯的审计记录。', process:['在路由与实例提取前后，检查正文完整性、内容有效性和证据充分性。','命中广告、碎片、抓取失败或事件不匹配等规则的内容被单独记录。','过滤记录保留原因和原文，避免低质量内容进入最终事件库。'], points:['展示过滤规则、原因代码、来源媒体与正文摘要。','过滤结果不会参与有效事件聚合，避免噪声污染结论。','可点击记录核对原始新闻与具体过滤依据。']},
  dedup: {number:'05', title:'去重与聚合说明', summary:'先识别同文转载，再将指向同一事实的多个实例合并为统一事件。', process:['先利用正文特征识别完全同文，形成转载链并确定传播顺序。','再比较主体、事实、时间与语义相似度，合并指向同一现实事件的实例。','合并后汇总媒体、报道、证据组和后续确认，形成统一事件。'], points:['“新闻去重与转载链”还原同文在媒体间的传播路径。','“事件实例合并”基于语义和证据把重复事实归并。','展示端对同媒体同时间的重复记录只呈现一次。']},
  library: {number:'06', title:'完整事件库说明', summary:'这里沉淀的是最终统一事件，并以证据规模和后续验证结果给出可信度与影响说明。', process:['由通过复核的事件实例经去重与语义合并后生成最终事件。','根据独立媒体数量、证据组、原始资料与后续确认计算事件可信度。','结合实例中的模型结构化影响原因，形成可解释的影响方向展示。'], points:['每条事件展示可信度、媒体/报道数量和后续确认次数。','影响方向及其原因来自事件实例中的模型结构化判断。','首页优先呈现可信、结论直观、适合演示的代表性案例。']},
  media: {number:'07', title:'媒体可信度说明', summary:'媒体分数由其报道对应事件的后续验证结果反向更新，形成逐笔可查的信誉账本。', process:['媒体发布新闻后，系统将其关联到已提取并合并的事件。','等待事件后续证据、独立报道和可信度结果，再对媒体信誉给予反馈。','按媒体、时间、事件去重后，逐笔计算加减分并累计为当前档案分数。'], points:['后续获得证实的报道产生正向反馈；无有效事件或低可信事件会产生负向反馈。','同一媒体、同一时间、同一事件的重复反馈只计算一次。','点击每一笔变更可查看触发新闻、验证信息、加减分理由和分数前后变化。']},
  chains: {number:'08', title:'事件链展示说明', summary:'系统把同一主题下的重大进展、确认、风险和回应按时间串联，呈现可追踪的演化过程。', process:['从最终事件中识别共享主体、时间相邻且存在合理关系的节点。','结合规则与模型判断确认、进展、市场反应、处置、升级或反转等关系。','按新闻的完整发布时间排序并折叠重复节点，生成可动态更新的事件链。'], points:['节点按对应新闻的完整发布时间（精确到秒）从早到晚排列。','展示层会折叠同一事件的重复节点，保留最早且可追溯的新闻。','点击节点可进入新闻详情；链路可触发动态更新和必要的风险预警。']},
};

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '数据读取失败');
  return data;
}
function intelligenceQuery(kind, options = {}) {
  return getJson('/api/intelligence/query?' + new URLSearchParams({
    kind, page: options.page || 1, size: options.size || 12, q: options.q || '',
    state: options.state || 'all', domain: 'all', order: options.order || '',
    min_publishers: options.minPublishers || 0
  }));
}
function upstreamQuery(kind, options = {}) {
  const params = {kind, page: options.page || 1, size: options.size || 12, q: options.q || ''};
  if (kind === 'routes') params.status = options.state || 'all';
  if (kind === 'mentions') { params.valid = options.state || 'all'; params.order = 'latest'; }
  if (kind === 'events') params.scope = options.state || 'all';
  return getJson('/api/query?' + new URLSearchParams(params));
}
function showLoading(selector, label = '正在读取真实结果') {
  $(selector).innerHTML = `<div class="loader">${esc(label)}</div>`;
}
function empty(message = '没有找到符合条件的记录', error = false) {
  return `<div class="empty ${error ? 'error' : ''}">${esc(message)}</div>`;
}
function setCaption(view, data, label) {
  const element = $(`#${view}-caption`);
  if (element) element.textContent = `${label}${data.showcase_priority ? ' · 典型匹配样本优先' : ''} · 本页 ${data.items.length} 条 · 第 ${data.page} 页 · ${data.updated_at || '实时数据'}`;
}
function renderPager(view) {
  const container = $(`[data-pager="${view}"]`);
  if (!container) return;
  const state = pageState[view];
  const totalPages = state.totalPages ? String(state.totalPages).padStart(2, '0') : '—';
  container.innerHTML = `<button class="pager-prev" data-direction="prev" ${state.page === 1 ? 'disabled' : ''}>← 上一页</button><span class="page-state">第 ${String(state.page).padStart(2, '0')} / ${totalPages} 页</span><label class="pager-jump"><input type="number" min="1" ${state.totalPages ? `max="${state.totalPages}"` : ''} value="${state.page}" aria-label="跳转页码"><button data-direction="jump">跳转</button></label><button class="pager-next" data-direction="next" ${!state.more ? 'disabled' : ''}>下一页 →</button>`;
  container.querySelectorAll('button').forEach(button => button.onclick = () => {
    const direction = button.dataset.direction;
    if (direction === 'jump') {
      const target = Number(container.querySelector('input').value);
      if (!Number.isInteger(target) || target < 1 || (state.totalPages && target > state.totalPages) || target === state.page) return;
      state.page = target;
    } else state.page += direction === 'next' ? 1 : -1;
    loadView(view, true);
    scrollTo({top:0, behavior:'smooth'});
  });
}
function bindDetailCards() {
  $$('[data-detail-kind]').forEach(card => card.onclick = event => {
    if (event.target.closest('button,a,input')) return;
    openDetail(card.dataset.detailKind, card.dataset.id, card.dataset.api || 'intelligence');
  });
}

function renderSectionGuide(guide) {
  const list = (items, className) => `<ol class="${className}">${items.map(point => `<li>${esc(point)}</li>`).join('')}</ol>`;
  return `<div class="guide-content"><span class="guide-number">${esc(guide.number)}</span><h2>${esc(guide.title)}</h2><p class="guide-summary">${esc(guide.summary)}</p><section><h3>如何产生</h3>${list(guide.process, 'guide-process')}</section><section><h3>如何理解这一部分</h3>${list(guide.points, 'guide-reading')}</section></div>`;
}

function openSectionGuide() {
  const guide = sectionGuides[activeView] || sectionGuides.taxonomy;
  const dialog = $('#guide-dialog');
  $('#guide-body').innerHTML = renderSectionGuide(guide);
  if (!dialog.open) dialog.showModal();
}

function scoreBar(score) {
  const value = Math.round(Number(score || 0) * 100);
  return `<div class="score-row"><span>可信度</span><i><em style="width:${value}%"></em></i><b>${value}</b></div>`;
}
function eventCard(item, kind = 'instances') {
  const isMergeCard = kind === 'merges';
  const reasons = item.confidence_reasons || [];
  if (isMergeCard) return `<article class="data-card event-card merge-card" data-detail-kind="${kind}" data-id="${esc(item.event_instance_id)}">
    <h3>${esc(clip(item.canonical_fact, 210))}</h3>
    <div class="meta-line merge-stats"><span>${fmt(item.publisher_count)} 家媒体</span><span>${fmt(item.article_count)} 篇报道</span><span>点击查看合并详情 →</span></div>
  </article>`;
  return `<article class="data-card event-card" data-detail-kind="${kind}" data-id="${esc(item.event_instance_id)}">
    <div class="card-top"><code>${esc(item.event_instance_id)}</code>${chip(item.credibility_level || item.credibility_state)}</div>
    <h3>${esc(clip(item.canonical_fact, 210))}</h3>
    <div class="meta-line"><span>${esc(item.anchor_entity?.name || '主体待定')}</span><span>${esc(item.primary_event_name || item.root_domain)}</span><span>${esc(item.event_date || item.first_seen_at || '日期待定')}</span></div>
    ${scoreBar(item.credibility_score)}
    <div class="reason-box"><b>为什么这样判断：</b>${esc(reasons.find(reason => !String(reason).startsWith('基础证据分')) || '综合来源数量、证据类型和后续确认情况评估')}</div>
    <div class="meta-line"><span>${fmt(item.publisher_count)} 家媒体</span><span>${fmt(item.article_count)} 篇报道</span><span>${fmt(item.followup_confirmation_count)} 次后续确认</span></div>
  </article>`;
}
function repostCard(item) {
  return `<article class="data-card repost-card" data-detail-kind="reposts" data-id="${esc(item.repost_group_id)}">
    <div class="card-top"><code>${esc(item.repost_group_id)}</code>${chip(item.origin_status)}</div>
    <h3>${esc(clip(item.title, 180))}</h3>
    <div class="meta-line repost-stats"><span>${fmt(item.article_count)} 篇完全同文</span><span>${fmt(item.media_count)} 家媒体</span><span>点击查看完整转载链 →</span></div>
  </article>`;
}
function chainCard(item) {
  const nodes = item.nodes || [];
  return `<article class="chain-card" data-detail-kind="chains" data-id="${esc(item.event_chain_id)}">
    <div class="chain-head"><div><span class="chain-symbol">${icon('chain')}</span><div class="chain-topic"><small>事件链追踪主题</small><b>${esc(item.chain_name || (nodes[0]?.fact ? clip(nodes[0].fact, 66) : '事件发展脉络'))}</b></div></div><div>${chip(item.current_state)}${chip(`${item.node_count} 个节点`, 'info')}</div></div>
    <div class="storyline">${nodes.map(node => `<div class="story-node"><time>${esc(node.publish_time || node.date || '时间待定')}</time><p>${esc(clip(node.fact, 125))}</p><div class="node-tags">${(node.annotations || []).map(tag => `<span class="${['反转','预警','风险升级'].includes(tag) ? 'alert' : ''}">${esc(tag)}</span>`).join('')}</div></div>`).join('')}</div>
    <div class="open-hint">点击查看完整事件链 <span>→</span></div>
  </article>`;
}

async function loadSummary() {
  summary = await getJson('/api/showcase');
  const metrics = summary.headline_metrics || {};
  $$('[data-metric]').forEach(element => element.textContent = fmt(metrics[element.dataset.metric]));
  $('#rail-validation').textContent = summary.validation_status === 'pass' ? '全部数据校验通过' : '数据需要检查';
  $('#rail-version').textContent = summary.validated_at ? `校验完成：${summary.validated_at}` : '已连接最新结果集';
  $('#footer-time').textContent = `数据校验时间：${summary.validated_at || '—'}`;
  const qualityReasons = summary.quality_reason_counts || {};
  $('#quality-reasons').innerHTML = Object.entries(qualityReasons).filter(([key]) => key !== 'content_shorter_than_repost_minimum').map(([key, value]) => `<span>${esc(textLabel(key))}<b>${fmt(value)}</b></span>`).join('');
  const annotations = summary.chain_annotations || {};
  $('#chain-annotations').innerHTML = [['反转',annotations.reversal],['预警',annotations.warning],['重大进展',annotations.major_progress],['官方确认',annotations.official_confirmation],['重新预警',annotations.realerts]].map(([key, value]) => `<span>${key}<b>${fmt(value)}</b></span>`).join('');
}

function pathParts(item) { return String(item.source_path || '').split(' > ').filter(Boolean); }
const taxonomyRootPriority = {
  company: ['公司治理与人事'],
  industry: ['农业与食品市场', '公共卫生与健康']
};
function orderTaxonomyRoots(roots) {
  const priority = item => {
    const index = (taxonomyRootPriority[item.scope] || []).indexOf(item.event_name);
    return index === -1 ? 99 : index;
  };
  return roots.map((item, index) => ({item, index})).sort((left, right) => {
    const scopeOrder = left.item.scope === right.item.scope ? 0 : left.item.scope === 'company' ? -1 : 1;
    return scopeOrder || priority(left.item) - priority(right.item) || left.index - right.index;
  }).map(({item}) => item);
}
function taxonomyNode(item, level, descendantCount = 0) {
  return `<button class="taxonomy-node level-${level}" data-event-node="${esc(item.event_id)}">
    <span class="node-level">L${level}</span><span class="node-copy"><b>${esc(item.event_name)}</b><small>${esc(item.event_id)}${descendantCount ? ` · ${descendantCount} 个下级事件` : ''}</small></span><span class="node-open">${icon('arrow')}</span>
  </button>`;
}
function renderTaxonomyTree(rows, query) {
  const roots = orderTaxonomyRoots(rows.filter(item => Number(item.level) === 1));
  const allRows = taxonomy;
  const lowerQuery = query.toLowerCase();
  const matches = item => !lowerQuery || [item.event_id,item.event_name,item.source_path].join(' ').toLowerCase().includes(lowerQuery);
  const html = roots.map((root, rootIndex) => {
    const rootPath = root.source_path;
    const level2 = allRows.filter(item => item.scope === root.scope && Number(item.level) === 2 && pathParts(item).slice(0, -1).join(' > ') === rootPath);
    const relevantLevel2 = level2.filter(item => matches(item) || allRows.some(child => child.scope === root.scope && Number(child.level) === 3 && pathParts(child).slice(0, -1).join(' > ') === item.source_path && matches(child)));
    if (lowerQuery && !matches(root) && !relevantLevel2.length) return '';
    const expanded = Boolean(lowerQuery);
    return `<article class="tree-domain ${expanded ? 'expanded' : ''}">
      <div class="tree-domain-head"><button class="tree-toggle" aria-label="展开一级事件">⌄</button>${taxonomyNode(root, 1, level2.length)}</div>
      <div class="tree-branches">
        ${(lowerQuery ? relevantLevel2 : level2).map((second, secondIndex) => {
          const level3 = allRows.filter(item => item.scope === root.scope && Number(item.level) === 3 && pathParts(item).slice(0, -1).join(' > ') === second.source_path);
          const relevantLevel3 = lowerQuery ? (matches(second) ? level3 : level3.filter(matches)) : level3;
          const branchExpanded = Boolean(lowerQuery);
          return `<section class="tree-branch ${branchExpanded ? 'expanded' : ''}"><div class="tree-branch-head"><button class="tree-toggle" aria-label="展开二级事件">⌄</button>${taxonomyNode(second, 2, level3.length)}</div><div class="tree-leaves">${relevantLevel3.map(third => taxonomyNode(third, 3)).join('') || '<p class="no-leaf">该二级事件下暂无三级事件卡</p>'}</div></section>`;
        }).join('') || '<p class="no-leaf">没有匹配的下级事件</p>'}
      </div>
    </article>`;
  }).join('');
  return html || empty('没有找到符合条件的事件卡');
}
async function loadTaxonomy() {
  showLoading('#taxonomy-results', '正在构建三级事件体系');
  try {
    if (!taxonomy.length) taxonomy = await getJson('/api/tree');
    const query = $('[data-search="taxonomy"]').value.trim();
    const scope = $('[data-filter="taxonomy"]').value;
    const scoped = taxonomy.filter(item => scope === 'all' || item.scope === scope);
    const company = taxonomy.filter(item => item.scope === 'company').length;
    const industry = taxonomy.filter(item => item.scope === 'industry').length;
    const roots = taxonomy.filter(item => Number(item.level) === 1).length;
    $('#taxonomy-overview').innerHTML = `<div class="scope-stat"><span>公司级事件</span><b>${fmt(company)}<em>张</em></b><small>企业经营活动与风险</small></div><div class="scope-stat"><span>产业级事件</span><b>${fmt(industry)}<em>张</em></b><small>产业、政策与宏观变化</small></div><div class="scope-stat"><span>一级事件域</span><b>${fmt(roots)}<em>个</em></b><small>点击后逐级展开到三级</small></div>`;
    $('#taxonomy-results').innerHTML = renderTaxonomyTree(scoped.filter(item => Number(item.level) === 1), query);
    $$('.tree-toggle').forEach(button => button.onclick = event => {
      event.stopPropagation();
      button.closest('.tree-domain,.tree-branch').classList.toggle('expanded');
    });
    $$('[data-event-node]').forEach(button => button.onclick = () => openDetail('events', button.dataset.eventNode, 'upstream'));
  } catch (error) { $('#taxonomy-results').innerHTML = empty(error.message, true); }
}

async function loadRouting() {
  const state = pageState.routing;
  const requestId = state.requestId = (state.requestId || 0) + 1;
  showLoading('#routing-results');
  try {
    const data = await upstreamQuery('routes', {page:state.page, q:$('[data-search="routing"]').value.trim(), state:$('[data-filter="routing"]').value});
    if (requestId !== state.requestId) return;
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('routing', data, '新闻路由');
    $('#routing-results').innerHTML = data.items.map(item => `<article class="data-card routing-card" data-detail-kind="routes" data-api="upstream" data-id="${esc(item.input_row_id)}">
      <div class="card-top"><code>${esc(item.input_row_id)}</code>${chip(item.route_status)}</div><h3>${esc(clip(item.article_title, 170))}</h3><p>${esc(clip(item.content_preview, 180))}</p>
      ${item.final_event_ids?.length ? `<div class="route-events">${item.routed_events.slice(0, 3).map(event => `<span>${esc(event.event_name)}</span>`).join('')}</div>` : `<div class="reason-box"><b>没有进入事件卡：</b>${esc(textLabel(item.trash_reason))}</div>`}
      <div class="meta-line"><span>${esc(item.article_source)}</span><span>${esc(item.article_publish_time)}</span></div></article>`).join('') || empty();
    renderPager('routing'); bindDetailCards();
  } catch (error) { $('#routing-results').innerHTML = empty(error.message, true); }
}
async function loadMentions() {
  const state = pageState.mentions;
  showLoading('#mentions-results');
  try {
    const data = await upstreamQuery('mentions', {page:state.page, q:$('[data-search="mentions"]').value.trim(), state:$('[data-filter="mentions"]').value});
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('mentions', data, '结构化事件实例');
    $('#mentions-results').innerHTML = data.items.map(item => {
      const extraction = item.extraction || {};
      if (item.pair_valid !== true) return `<article class="data-card mention-card invalid-mention-card" data-detail-kind="mentions" data-api="upstream" data-id="${esc(item.mention_id)}"><div class="card-top"><code>${esc(item.mention_id)}</code>${chip(String(item.pair_valid))}</div><div class="reason-box"><b>无效原因：</b>${esc(textLabel(item.invalid_reason || '未说明'))}</div></article>`;
      return `<article class="data-card mention-card" data-detail-kind="mentions" data-api="upstream" data-id="${esc(item.mention_id)}"><div class="card-top"><code>${esc(item.mention_id)}</code>${chip(String(item.pair_valid))}</div><h3>${esc(extraction.event_fact || item.article_title || '未形成有效事件事实')}</h3><div class="field-grid"><div><small>锚定实体</small><b>${esc(extraction.anchor_entity?.name || extraction.anchor_entity || '—')}</b></div><div><small>事件类型</small><b>${esc(item.event_name || '—')}</b></div><div><small>影响方向</small><b>${esc(textLabel(extraction.impact_direction))}</b></div><div><small>事实状态</small><b>${esc(textLabel(extraction.assertion_status))}</b></div></div><div class="meta-line"><span>${esc(item.article_source)}</span><span>${esc(item.publication_time)}</span><span>点击查看提取详情</span></div></article>`;
    }).join('') || empty();
    renderPager('mentions'); bindDetailCards();
  } catch (error) { $('#mentions-results').innerHTML = empty(error.message, true); }
}
async function loadQuality() {
  const state = pageState.quality;
  showLoading('#quality-results');
  try {
    const data = await intelligenceQuery('quality', {page:state.page, q:$('[data-search="quality"]').value.trim(), state:$('[data-filter="quality"]').value});
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('quality', data, '过滤审计');
    $('#quality-results').innerHTML = data.items.map(item => `<article class="data-card quality-card" data-detail-kind="quality" data-id="${esc(item.input_row_id)}"><div class="card-top"><code>${esc(item.input_row_id)}</code>${chip('已过滤','bad')}</div><h3>${esc(item.title || '无标题内容')}</h3><p>${esc(clip(item.content_excerpt, 190) || '正文为空')}</p><div class="route-events">${(item.filter_reason_codes || []).map(reason => `<span>${esc(textLabel(reason))}</span>`).join('')}</div><div class="meta-line"><span>${esc(item.publisher)}</span><span>正文 ${fmt(item.normalized_content_length)} 字</span><span>点击查看过滤原因</span></div></article>`).join('') || empty();
    renderPager('quality'); bindDetailCards();
  } catch (error) { $('#quality-results').innerHTML = empty(error.message, true); }
}
async function loadDedup() {
  const state = pageState.dedup;
  showLoading('#dedup-results');
  try {
    const data = await intelligenceQuery(state.kind, {page:state.page, q:$('[data-search="dedup"]').value.trim()});
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('dedup', data, state.kind === 'reposts' ? '新闻去重与转载链' : 'LLM事件实例合并');
    $('#dedup-results').innerHTML = data.items.map(item => state.kind === 'reposts' ? repostCard(item) : eventCard(item, 'merges')).join('') || empty();
    renderPager('dedup'); bindDetailCards();
  } catch (error) { $('#dedup-results').innerHTML = empty(error.message, true); }
}
async function loadLibrary() {
  const state = pageState.library;
  showLoading('#library-results');
  try {
    const data = await intelligenceQuery('instances', {page:state.page, q:$('[data-search="library"]').value.trim(), state:$('[data-filter="library"]').value});
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('library', data, '最终统一事件');
    $('#library-results').innerHTML = data.items.map(item => eventCard(item, 'instances')).join('') || empty();
    renderPager('library'); bindDetailCards();
  } catch (error) { $('#library-results').innerHTML = empty(error.message, true); }
}
async function loadMedia() {
  const state = pageState.media;
  showLoading('#media-results');
  try {
    const data = await intelligenceQuery('media', {page:state.page, q:$('[data-search="media"]').value.trim(), state:$('[data-filter="media"]').value, order:'score'});
    state.more = data.has_more;
    state.totalPages = data.total_pages || null;
    setCaption('media', data, '媒体可信度档案');
    $('#media-results').innerHTML = data.items.map(item => {
      const resolved = Number(item.increases || 0) + Number(item.decreases || 0);
      return `<article class="data-card media-card" data-detail-kind="media" data-id="${esc(item.publisher_family)}"><div class="media-head"><div><div class="card-top"><code>${fmt(resolved)} 条升降记录</code>${chip(item.credibility_level)}</div><h3>${esc(item.publisher_family)}</h3></div><div class="media-score">${Number(item.credibility_score || 0).toFixed(1)}</div></div><div class="feedback-grid two"><span><b>${fmt(item.increases)}</b>上升记录</span><span><b>${fmt(item.decreases)}</b>下降记录</span></div></article>`;
    }).join('') || empty();
    renderPager('media'); bindDetailCards();
  } catch (error) { $('#media-results').innerHTML = empty(error.message, true); }
}
async function loadChains() {
  const state = pageState.chains;
  showLoading('#chains-results');
  try {
    const data = await intelligenceQuery('chains', {page:state.page, size:8, q:$('[data-search="chains"]').value.trim(), state:$('[data-filter="chains"]').value});
    state.more = data.has_more;
    state.totalPages = data.total_pages;
    setCaption('chains', data, '全量事件链');
    $('#chains-results').innerHTML = data.items.map(chainCard).join('') || empty();
    renderPager('chains'); bindDetailCards();
  } catch (error) { $('#chains-results').innerHTML = empty(error.message, true); }
}

const loaders = {taxonomy:loadTaxonomy, routing:loadRouting, mentions:loadMentions, quality:loadQuality, dedup:loadDedup, library:loadLibrary, media:loadMedia, chains:loadChains};
async function loadView(view, force = false) {
  const state = pageState[view];
  if (state && !force && state.loaded) return;
  await loaders[view]();
  if (state) state.loaded = true;
}
function activate(view) {
  if (!loaders[view]) view = 'taxonomy';
  activeView = view;
  $$('.module-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.workspace-view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  const section = $(`#view-${view}`);
  $('#section-number').textContent = section.dataset.number;
  $('#section-title').textContent = section.dataset.title;
  $('#section-subtitle').textContent = section.dataset.subtitle;
  $('#section-guide').setAttribute('aria-label', `${section.dataset.number} ${section.dataset.title}说明`);
  history.replaceState(null, '', `#${view}`);
  scrollTo({top:0, behavior:'smooth'});
  loadView(view);
}

function detailFrame(kicker, title, body, extraClass = '') {
  return `<div class="detail-content ${extraClass}"><p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2>${body}</div>`;
}
function criteriaList(items, emptyText) {
  return items?.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : `<p class="detail-empty">${esc(emptyText)}</p>`;
}
function renderEventDefinition(record) {
  const node = record.target_node || {};
  const name = node.event_name || record.event_id;
  const isRoot = Number(node.level) === 1;
  const inclusion = node.inclusion_criteria?.length ? node.inclusion_criteria : isRoot ? [
    `事件事实符合“${name}”的定义边界，并具备明确、可验证的依据。`,
    '可根据事件性质进一步归入本事件域下的二级或三级事件卡。'
  ] : [];
  const exclusion = node.exclusion_criteria?.length ? node.exclusion_criteria : isRoot ? [
    `仅与“${name}”存在词语关联、但不符合其实体定义边界的信息。`,
    '一般背景评论、日常信息或尚未形成明确事件事实的表述。'
  ] : [];
  return detailFrame('事件卡说明', name, `<div class="clean-id"><span>事件编号</span><code>${esc(record.event_id)}</code></div><section class="definition-panel"><span>事件定义</span><p>${esc(node.definition || '暂无定义')}</p></section><div class="criteria-grid"><section class="criteria include"><header><i>${icon('check')}</i><b>收录条件</b></header>${criteriaList(inclusion, '该层级不单独设置收录条件')}</section><section class="criteria exclude"><header><i>${icon('close')}</i><b>排斥条件</b></header>${criteriaList(exclusion, '该层级不单独设置排斥条件')}</section></div>`, 'event-definition-detail');
}
function routedBoundary(kind, label, items) {
  const entries = (items || []).slice(0, 2);
  return `<section class="routed-boundary ${kind}"><header><i>${icon(kind === 'include' ? 'check' : 'close')}</i><b>${label}</b>${items?.length ? `<small>${items.length} 条</small>` : ''}</header>${entries.length ? `<ul>${entries.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p>该事件卡未单独设置</p>'}</section>`;
}
function renderRouteDetail(record) {
  const article = record.article || {};
  const cards = record.routed_event_cards || [];
  const cardHtml = cards.length ? cards.map(card => `<article class="routed-card-detail"><div class="clean-id"><span>事件卡 ID</span><code>${esc(card.event_id)}</code></div>${card.parent_path?.length ? `<div class="parent-path">${card.parent_path.map(parent => `<span><small>L${parent.level}</small>${esc(parent.event_name)}</span>`).join('<i>→</i>')}<i>→</i><span class="current"><small>L${card.level}</small>${esc(card.event_name)}</span></div>` : ''}<h3>${esc(card.event_name)}</h3><p>${esc(card.definition || '暂无定义')}</p><div class="routed-boundaries">${routedBoundary('include', '收录条件', card.inclusion_criteria)}${routedBoundary('exclude', '排斥条件', card.exclusion_criteria)}</div></article>`).join('') : `<div class="route-empty-detail"><b>这条新闻没有进入任何事件卡</b><p>${esc(textLabel(record.trash_reason))}</p></div>`;
  return detailFrame('新闻路由详情', article.article_title || record.input_row_id, `<div class="clean-id"><span>新闻编号</span><code>${esc(record.input_row_id)}</code></div><div class="detail-two-column"><section class="article-paper"><header><span>${icon('article')}</span><b>新闻正文</b></header><p>${esc(article.content || '正文为空')}</p></section><section class="routed-stack"><header class="section-label"><span>${icon('route')}</span><b>对应事件卡</b></header>${cardHtml}</section></div>`, 'route-detail');
}
function renderMentionDetail(record) {
  const article = record.article || {};
  if (record.pair_valid !== true) return detailFrame('无效实例详情', article.article_title || record.input_row_id, `<div class="clean-id"><span>原始新闻编号</span><code>${esc(record.input_row_id)}</code></div><section class="filter-reason-detail"><header><span>${icon('close')}</span><b>无效原因</b></header><div><i>${icon('close')}</i><span><b>${esc(textLabel(record.invalid_reason || '未说明'))}</b></span></div></section><section class="article-paper invalid-article"><header><span>${icon('article')}</span><b>原始新闻内容</b></header><p>${esc(article.content || '正文为空')}</p></section>`, 'invalid-mention-detail');
  const extraction = {
    event_fact: record.event_fact, impact_direction: record.impact_direction, impact_reason: record.impact_reason,
    ...(record.extraction || {})
  };
  const final = record.final_event_instance || {};
  const score = final.credibility_score;
  return detailFrame('事件实例详情', article.article_title || record.input_row_id, `<div class="clean-id"><span>新闻编号</span><code>${esc(record.input_row_id)}</code></div><div class="mention-detail-grid"><section class="fact-spotlight"><span>提取到的事件正文</span><p>${esc(extraction.event_fact || '未提取到有效事件正文')}</p></section><section class="compact-score"><span>事件可信度</span><b>${score == null ? '待聚合' : `${Math.round(score * 100)}分`}</b><small>${esc(textLabel(final.credibility_level || ''))}</small></section><section class="impact-panel"><span>影响方向</span><b>${esc(textLabel(extraction.impact_direction))}</b><p>${esc(extraction.impact_reason || '未提供影响判断理由')}</p></section></div>${final.credibility_explanation?.length ? `<section class="plain-explanation"><header>${icon('score')} 为什么得到这个可信度</header>${final.credibility_explanation.map(line => `<p>${esc(line)}</p>`).join('')}</section>` : ''}`, 'mention-detail');
}
function renderQualityDetail(record) {
  const article = record.article || {};
  const reasons = record.filter_reason_codes || [];
  return detailFrame('内容过滤详情', record.title || article.title || record.input_row_id, `<div class="clean-id"><span>新闻编号</span><code>${esc(record.input_row_id)}</code></div><section class="article-paper"><header><span>${icon('article')}</span><b>新闻正文</b></header><p>${esc(article.content || record.content_excerpt || '正文为空')}</p></section><section class="filter-reason-detail"><header><span>${icon('filter')}</span><b>过滤原因</b></header>${reasons.map(reason => `<div><i>${icon('close')}</i><span><b>${esc(textLabel(reason))}</b></span></div>`).join('')}</section>`, 'quality-detail');
}
function renderRepostDetail(record) {
  const timeline = record.timeline || [];
  const duplicateNote = Number(record.collapsed_duplicate_count || 0) ? `<span>已合并 ${fmt(record.collapsed_duplicate_count)} 条同媒体、同时间重复记录</span>` : '';
  return detailFrame('转载链详情', timeline[0]?.title || record.repost_group_id, `<div class="repost-detail-layout"><section><header class="section-label"><span>${icon('repost')}</span><b>转载链（${fmt(timeline.length)}条）</b>${duplicateNote}</header><div class="full-propagation">${timeline.map((node, index) => `<button class="repost-news-item" data-article-reader="repost-article-reader" data-article-id="${esc(node.input_row_id)}"><i>${index + 1}</i><div><time>${esc(node.publish_time)}</time><b>${esc(node.media_normalized || node.media)}</b><code>${esc(node.input_row_id)}</code><p>${esc(node.title)}</p></div><span>${index === 0 ? '最早观测' : `+${Math.round(node.delay_from_first_minutes || 0)}分钟`}</span></button>`).join('')}</div></section><section class="source-reader repost-article-reader" id="repost-article-reader"><div class="reader-placeholder"><span>${icon('article')}</span><b>点击左侧新闻查看新闻 ID、标题和正文</b></div></section></div><p class="detail-footnote">转载顺序根据当前数据中的发布时间推断；最早观测不等同于法律意义上的原创证明。</p>`, 'repost-detail');
}
function sourceBrowser(members, readerId) {
  return `<div class="source-browser"><div class="source-list">${members.map((member, index) => `<button class="source-item ${index === 0 ? 'active' : ''}" data-article-reader="${readerId}" data-article-id="${esc(member.news_id)}"><span>${String(index + 1).padStart(2, '0')}</span><div><b>${esc(member.title || '标题暂缺')}</b><small>${esc(member.news_id)} · ${esc(member.publisher || '')}</small></div></button>`).join('')}</div><article class="source-reader" id="${readerId}"><div class="reader-placeholder"><span>${icon('article')}</span><b>点击左侧新闻查看正文</b></div></article></div>`;
}
function renderMergeDetail(record) {
  const members = record.members || [];
  return detailFrame('LLM EVENT INSTANCE MERGE', '多条新闻合并为一个统一事件', `<div class="merge-workbench"><section class="merge-sources"><header class="section-label"><span>${icon('article')}</span><b>合并前的新闻（${fmt(members.length)}条）</b></header>${sourceBrowser(members, 'merge-article-reader')}</section><div class="merge-arrow"><i>${icon('arrow')}</i><span>语义归并</span></div><section class="merged-result"><header><span>${icon('merge')}</span><b>合并后的事件</b></header><div class="clean-id"><span>事件 ID</span><code>${esc(record.event_instance_id)}</code></div><p>${esc(record.canonical_fact)}</p>${record.llm_merge_reason ? `<div class="llm-human-note"><b>合并理由</b>${esc(record.llm_merge_reason)}</div>` : ''}</section></div>`, 'merge-detail');
}
function impactText(record) {
  const directions = record.impact_directions || [];
  return directions.length ? directions.map(textLabel).join('、') : '未判断';
}
function impactEvidence(record) {
  const reasons = record.impact_explanations || [];
  const direction = impactText(record);
  const title = direction && direction !== '未判断' ? `LLM 为什么判断为${direction}` : 'LLM 影响判断理由';
  if (!reasons.length) return `<section class="impact-evidence empty-evidence"><header><span>${icon('arrow')}</span><div><b>${title}</b><small>事件提取阶段生成</small></div></header><p>当前事件尚未生成可展示的影响理由。</p></section>`;
  const representative = reasons[0];
  return `<section class="impact-evidence"><header><span>${icon('arrow')}</span><div><b>${title}</b><small>事件提取阶段由 LLM 生成</small></div></header><article><p>${esc(representative.reason)}</p></article></section>`;
}
function renderInstanceDetail(record) {
  const members = record.members || [];
  const explanation = record.credibility_explanation || [];
  return detailFrame('事件库详情', record.canonical_fact || record.event_instance_id, `<div class="library-detail-grid"><section class="library-sources"><header class="section-label"><span>${icon('article')}</span><b>原始新闻（${fmt(members.length)}条）</b><small>点击左侧新闻查看全文</small></header>${sourceBrowser(members, 'library-article-reader')}</section><section class="event-verdict"><div class="clean-id"><span>事件编号</span><code>${esc(record.event_instance_id)}</code></div><div class="verdict-fact"><span>统一事件正文</span><p>${esc(record.canonical_fact)}</p></div><div class="verdict-metrics"><div><span>事件可信度</span><b>${Math.round(Number(record.credibility_score || 0) * 100)}分</b></div><div><span>影响方向</span><b>${esc(impactText(record))}</b></div></div>${impactEvidence(record)}<section class="plain-explanation"><header>${icon('score')} 可信度为什么是这个分数</header>${explanation.map(line => `<p>${esc(line)}</p>`).join('')}</section></section></div>`, 'library-detail');
}
function renderMediaDetail(record) {
  const history = record.history || [];
  return detailFrame('媒体信誉变更', record.publisher_family, `<div class="media-detail-head"><div><span>当前信誉分</span><b>${Number(record.credibility_score || 0).toFixed(1)}</b><small>${esc(textLabel(record.credibility_level))}</small></div><div class="resolved-counts"><span class="rise"><b>${fmt(record.increases)}</b>次上升</span><span class="fall"><b>${fmt(record.decreases)}</b>次下降</span></div></div><section class="reputation-history"><header><span>${icon('media')}</span><b>信誉分变更记录</b><small>从近到远 · 点击任意记录查看详情</small></header>${history.map(item => {const delta = Number(item.score_delta || 0);return `<button class="history-item ${item.action}" data-media-record="${esc(JSON.stringify(item))}"><i>${item.action === 'increase' ? icon('up') : icon('down')}</i><div><time>${esc(item.observed_at || '时间未知')}</time><p>${esc(item.reason || textLabel(item.reason_code))}</p><small>${esc(item.domain || '全局')} · ${esc(item.news_id || '')}</small></div><div class="history-score"><b>${delta >= 0 ? '+' : ''}${delta.toFixed(3)}</b><small>${scoreTransition(item.score_before, item.score_after)}</small><em>查看详情 →</em></div></button>`;}).join('') || empty('暂无已经解决的升降分记录')}</section>`, 'media-detail');
}
function recordArticlePanel(article) {
  if (!article) return `<section class="article-paper"><header><span>${icon('article')}</span><b>触发本次评分的新闻</b></header><p>对应新闻暂不可读取。</p></section>`;
  return `<section class="article-paper media-trigger-article"><header><span>${icon('article')}</span><div><b>触发本次评分的新闻</b><small>${esc(article.news_id || '')} · ${esc(article.publisher || '')} · ${esc(article.publish_time || '')}</small></div></header><h3>${esc(article.title || '无标题')}</h3><p>${esc(article.content || '正文为空')}</p></section>`;
}
function routeMatchContext(article) {
  const cards = article?.routed_event_cards || [];
  if (!cards.length) return '';
  return `<section class="route-match-context"><header><span>${icon('route')}</span><div><b>路由命中的事件卡</b><small>新闻已路由成功，但后续匹配复核未形成有效事件实例</small></div></header><div class="route-match-cards">${cards.map(card => `<article><code>${esc(card.event_id)}</code><b>${esc(card.event_name || '事件卡')}</b><small>${esc(card.source_path || '')}</small></article>`).join('')}</div></section>`;
}
function verificationMembers(update, instance) {
  const members = instance?.members || [];
  const current = members.findIndex(member => member.news_id === update.news_id);
  const later = current >= 0 ? members.slice(current + 1) : members.filter(member => member.news_id !== update.news_id);
  const candidates = later.length ? later : members.filter(member => member.news_id !== update.news_id);
  return candidates.filter((member, index, list) => list.findIndex(item => item.news_id === member.news_id) === index).slice(0, 4);
}
function eventVerificationContext(update, instance) {
  if (!instance) return '';
  const related = verificationMembers(update, instance);
  const score = Number(instance.credibility_score || 0);
  const scoreText = `${Math.round(score * 100)}分（${score.toFixed(3)}）`;
  return `<section class="media-confirmations"><header><span>${icon('check')}</span><div><b>后续确认与交叉验证</b><small>该事件的后续可信度：${scoreText}</small></div></header><div class="verification-metrics"><span><b>${fmt(instance.publisher_count)}</b>家媒体</span><span><b>${fmt(instance.article_count)}</b>篇报道</span><span><b>${fmt(instance.followup_confirmation_count)}</b>次后续确认</span></div>${related.length ? `${sourceBrowser(related, 'media-confirmation-reader')}` : '<p class="no-verification">当前没有可展示的其他交叉验证新闻。</p>'}</section>`;
}
function renderMediaRecordDetail(publisher, update, article, instance) {
  const increase = update.action === 'increase';
  const delta = Number(update.score_delta || 0);
  const reasonTitle = increase ? '本次加分理由' : '本次扣分理由';
  const context = increase ? eventVerificationContext(update, instance) : routeMatchContext(article);
  return detailFrame('信誉变更详情', `${publisher} · ${increase ? '加分记录' : '扣分记录'}`, `<button class="detail-back" data-back-media="${esc(publisher)}">← 返回媒体信誉档案</button><section class="record-change-summary ${increase ? 'increase' : 'decrease'}"><div><span>本次信誉变化</span><b>${delta >= 0 ? '+' : ''}${delta.toFixed(3)}</b><small>${scoreTransition(update.score_before, update.score_after)}</small></div><div><span>记录时间</span><b>${esc(update.observed_at || '时间未知')}</b><small>${esc(update.domain || '全局')}</small></div></section><section class="record-reason ${increase ? 'increase' : 'decrease'}"><header><span>${increase ? icon('up') : icon('down')}</span><b>${reasonTitle}</b></header><p>${esc(update.reason || textLabel(update.reason_code))}</p></section>${context}${recordArticlePanel(article)}`, 'media-record-detail');
}
async function openMediaRecordDetail(publisher, update) {
  const body = $('#detail-body');
  mediaRecordParent = publisher;
  body.innerHTML = '<div class="detail-content"><div class="loader">正在整理信誉变更详情</div></div>';
  try {
    const articlePromise = update.news_id ? getJson(`/api/article?id=${encodeURIComponent(update.news_id)}`) : Promise.resolve(null);
    const instancePromise = update.event_instance_id ? getJson(`/api/intelligence/detail?kind=instances&id=${encodeURIComponent(update.event_instance_id)}`).catch(() => null) : Promise.resolve(null);
    const [article, instance] = await Promise.all([articlePromise, instancePromise]);
    body.innerHTML = renderMediaRecordDetail(publisher, update, article, instance);
    const back = body.querySelector('[data-back-media]');
    if (back) back.onclick = () => { mediaRecordParent = null; openDetail('media', publisher); };
    bindArticleReaders(body);
  } catch (error) { body.innerHTML = `<div class="detail-content">${empty(error.message, true)}</div>`; }
}
function bindMediaRecordDetails(container, publisher) {
  container.querySelectorAll('[data-media-record]').forEach(button => button.onclick = () => {
    try { openMediaRecordDetail(publisher, JSON.parse(button.dataset.mediaRecord)); }
    catch { /* A malformed legacy row is not actionable. */ }
  });
}
function renderChainDetail(record) {
  const nodes = record.nodes || [];
  return detailFrame('事件链详情', record.chain_name || (nodes[0]?.fact ? clip(nodes[0].fact, 80) : '完整事件链'), `<div class="chain-detail-topic"><span>追踪主题</span><b>${esc(record.chain_name || '事件发展脉络')}</b></div><div class="polished-chain">${nodes.map((node, index) => `<article class="polished-node ${node.news_id ? 'is-openable' : ''}" ${node.news_id ? `data-chain-news-id="${esc(node.news_id)}" tabindex="0" role="button" aria-label="查看第 ${index + 1} 个节点对应新闻详情"` : ''}><div class="node-rail"><span>${index + 1}</span>${index < nodes.length - 1 ? '<i></i>' : ''}</div><div class="node-body"><time>${esc(node.publish_time || node.date || '时间待定')}</time><p>${esc(node.fact)}</p><div class="node-tags">${(node.annotations || []).map(tag => `<span class="${['反转','预警','风险升级'].includes(tag) ? 'alert' : ''}">${esc(tag)}</span>`).join('') || '<span>持续跟踪</span>'}</div>${node.news_id ? '<span class="chain-news-open">点击卡片查看对应新闻详情 →</span>' : ''}</div></article>`).join('')}</div>`, 'chain-detail');
}

function renderChainNewsDetail(article) {
  return `<div class="detail-content chain-news-detail"><span class="eyebrow">事件链节点 · 原始新闻</span><h2>${esc(article.title || '无标题')}</h2><div class="chain-news-meta"><code>${esc(article.news_id || '新闻 ID 未知')}</code><span>${esc(article.publisher || '来源未知')}</span><span>${esc(article.publish_time || '时间未知')}</span></div><article class="chain-news-paper"><h3>新闻正文</h3><p>${esc(article.content || '正文为空')}</p></article></div>`;
}

async function openChainNewsDetail(newsId) {
  const dialog = $('#article-detail-dialog');
  const body = $('#article-detail-body');
  if (!dialog.open) dialog.showModal();
  body.innerHTML = '<div class="detail-content"><div class="loader">正在读取新闻详情</div></div>';
  try {
    const article = await getJson(`/api/article?id=${encodeURIComponent(newsId)}`);
    body.innerHTML = renderChainNewsDetail(article);
  } catch (error) { body.innerHTML = `<div class="detail-content">${empty(error.message, true)}</div>`; }
}

function bindChainNewsDetails(container) {
  container.querySelectorAll('[data-chain-news-id]').forEach(card => {
    const open = () => openChainNewsDetail(card.dataset.chainNewsId);
    card.onclick = open;
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    };
  });
}

async function bindArticleReaders(container, openFirst = true) {
  container.querySelectorAll('[data-article-id]').forEach(button => button.onclick = async () => {
    const reader = $(`#${button.dataset.articleReader}`);
    container.querySelectorAll(`[data-article-reader="${button.dataset.articleReader}"]`).forEach(item => item.classList.toggle('active', item === button));
    reader.classList.remove('is-empty');
    reader.innerHTML = '<div class="loader">正在读取新闻正文</div>';
    reader.scrollIntoView({behavior:'smooth', block:'start'});
    try {
      const article = await getJson(`/api/article?id=${encodeURIComponent(button.dataset.articleId)}`);
      reader.innerHTML = `<header><span>${icon('article')}</span><div><b>${esc(article.title || '无标题')}</b><small>${esc(article.news_id)} · ${esc(article.publisher || '')} · ${esc(article.publish_time || '')}</small></div></header><p>${esc(article.content || '正文为空')}</p>`;
    } catch (error) { reader.innerHTML = empty(error.message, true); }
  });
  const first = container.querySelector('[data-article-id]');
  if (openFirst && first) first.click();
}
async function openDetail(kind, identity, apiType = 'intelligence') {
  const dialog = $('#detail-dialog');
  const body = $('#detail-body');
  if (kind === 'media') mediaRecordParent = null;
  if (!dialog.open) dialog.showModal();
  body.innerHTML = '<div class="detail-content"><div class="loader">正在整理展示内容</div></div>';
  try {
    const endpoint = apiType === 'upstream' ? '/api/detail' : '/api/intelligence/detail';
    const record = await getJson(`${endpoint}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(identity)}`);
    const renderers = {
      events:renderEventDefinition, routes:renderRouteDetail, mentions:renderMentionDetail, quality:renderQualityDetail,
      reposts:renderRepostDetail, merges:renderMergeDetail, instances:renderInstanceDetail, media:renderMediaDetail, chains:renderChainDetail
    };
    body.innerHTML = renderers[kind] ? renderers[kind](record) : empty('暂无对应展示模板');
    if (kind === 'media') bindMediaRecordDetails(body, record.publisher_family);
    else if (['reposts','merges','instances'].includes(kind)) bindArticleReaders(body);
    else if (kind === 'chains') bindChainNewsDetails(body);
  } catch (error) { body.innerHTML = `<div class="detail-content">${empty(error.message, true)}</div>`; }
}

$('#module-nav').onclick = event => {
  const button = event.target.closest('button[data-view]');
  if (button) activate(button.dataset.view);
};
$$('[data-run]').forEach(button => button.onclick = () => {
  const view = button.dataset.run;
  if (pageState[view]) { pageState[view].page = 1; pageState[view].loaded = false; }
  loadView(view, true);
});
$$('[data-search]').forEach(input => input.onkeydown = event => {
  if (event.key === 'Enter') $(`[data-run="${input.dataset.search}"]`).click();
});
$$('[data-filter]').forEach(select => select.onchange = () => {
  const view = select.dataset.filter;
  if (pageState[view]) { pageState[view].page = 1; pageState[view].loaded = false; }
  loadView(view, true);
});
$('#dedup-switch').onclick = event => {
  const button = event.target.closest('[data-dedup-kind]');
  if (!button) return;
  pageState.dedup.kind = button.dataset.dedupKind;
  pageState.dedup.page = 1;
  $$('#dedup-switch button').forEach(item => item.classList.toggle('active', item === button));
  $('[data-search="dedup"]').value = '';
  loadView('dedup', true);
};
$('#refresh-view').onclick = () => {
  if (pageState[activeView]) pageState[activeView].loaded = false;
  loadView(activeView, true);
};
$('#section-guide').onclick = openSectionGuide;
$('.dialog-close').onclick = () => {
  if (mediaRecordParent) {
    const publisher = mediaRecordParent;
    mediaRecordParent = null;
    openDetail('media', publisher);
    return;
  }
  $('#detail-dialog').close();
};
$('#detail-dialog').onclick = event => { if (event.target === $('#detail-dialog')) $('#detail-dialog').close(); };
$('#article-detail-dialog .dialog-close').onclick = () => $('#article-detail-dialog').close();
$('#article-detail-dialog').onclick = event => { if (event.target === $('#article-detail-dialog')) $('#article-detail-dialog').close(); };
$('#guide-dialog .dialog-close').onclick = () => $('#guide-dialog').close();
$('#guide-dialog').onclick = event => { if (event.target === $('#guide-dialog')) $('#guide-dialog').close(); };

(async () => {
  try { await loadSummary(); }
  catch (error) { $('#rail-validation').textContent = '数据连接失败'; $('#rail-version').textContent = error.message; }
  activate(location.hash.slice(1) || 'taxonomy');
})();
