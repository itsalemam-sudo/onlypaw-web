#!/usr/bin/env node
/**
 * OnlyPaw programmatic-SEO page generator.
 *
 * Reads:
 *   data/cities.json
 *   data/services.json
 *   data/rate-tiers.json
 *   data/fx.json
 *
 * Emits:
 *   pages/services/{service}-in-{city}.html
 *   pages/costs/{service}-cost-in-{city}.html
 *   pages/services/index.html
 *   pages/costs/index.html
 *
 * And rewrites sitemap.xml at repo root.
 *
 * No external deps. Determinism is city.slug-hashed so no two
 * cities render byte-identical body content.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT_SERVICES = path.join(ROOT, 'pages', 'services');
const OUT_COSTS = path.join(ROOT, 'pages', 'costs');
const DOMAIN = 'https://onlypaw.net';
const TODAY = '2026-09-08';

// ---------- load data ----------
const cities   = JSON.parse(fs.readFileSync(path.join(DATA, 'cities.json'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(DATA, 'services.json'), 'utf8'));
const rates    = JSON.parse(fs.readFileSync(path.join(DATA, 'rate-tiers.json'), 'utf8'));
const fx       = JSON.parse(fs.readFileSync(path.join(DATA, 'fx.json'), 'utf8'));

// ---------- deterministic pseudo-random from a slug ----------
function slugHash(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, seed) {
  return arr[seed % arr.length];
}

// ---------- currency conversion & formatting ----------
function toLocal(usd, currency) {
  const rate = fx[currency];
  if (typeof rate !== 'number') return usd;
  const local = usd * rate;
  // rounding rules: whole numbers for high-magnitude currencies
  if (local >= 500) return Math.round(local / 10) * 10;
  if (local >= 50) return Math.round(local);
  return Math.round(local * 10) / 10;
}
function fmtMoney(usd, city) {
  const local = toLocal(usd, city.currency);
  const sym = city.currency_symbol;
  const s = local >= 100 ? Math.round(local).toLocaleString('en-US')
                         : (Math.round(local * 10) / 10).toString();
  // spacing convention: symbols like AED / SAR / kr use trailing space; others prepend
  const post = new Set(['kr', 'zł', 'CHF', 'AED', 'SAR', 'QAR', 'KWD']);
  if (post.has(sym)) return `${s} ${sym}`;
  return `${sym}${s}`;
}
function rangeStr(minUsd, maxUsd, city) {
  return `${fmtMoney(minUsd, city)}–${fmtMoney(maxUsd, city)}`;
}

// ---------- html escaping ----------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function jsonLd(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

// ---------- reusable topbar + footer ----------
function topbar() {
  return `<header class="topbar">
  <a class="brand" href="/"><span class="paw">🐾</span> <span>OnlyPaw</span></a>
  <nav class="nav">
    <a href="/#services">Services</a>
    <a href="/for-providers/">For providers</a>
    <a href="/pages/services/">Services near you</a>
    <a href="/blog/">Blog</a>
    <a href="/pages/signup-customer.html" class="cta-sm">Get started</a>
  </nav>
</header>`;
}
function footer() {
  return `<footer class="footer"><div class="footer-inner"><div><a class="brand" href="/"><span class="paw">🐾</span> OnlyPaw</a><p class="small">Pet care, reimagined worldwide.</p></div><div><h4>Legal</h4><a href="/pages/terms.html">Terms</a><a href="/pages/privacy.html">Privacy</a></div><div><h4>Company</h4><a href="/blog/">Blog</a><a href="/pages/support.html">Support</a><a href="/for-providers/">For providers</a></div><div><h4>For team</h4><a href="https://admin.onlypaw.net">Admin login</a></div></div><p class="copyright">© 2026 OnlyPaw. All rights reserved.</p></footer>`;
}

// ---------- sentence variants (deterministic pick per city) ----------
const INTRO_TEMPLATES = [
  (c, s) => `Booking ${s.name.toLowerCase()} in ${c.name} is not the same problem as booking it two time zones away. ${c.name}'s ${c.climate} shapes when you walk, where you walk, and what a good ${s.provider_word} needs in their bag. Locals build their week around ${pick(c.pet_friendly_parks, slugHash(c.slug+s.slug))} and a handful of side streets that stay quiet at commute time. If your ${s.provider_word} on OnlyPaw can name three of those routes without prompting, you're on the right side of the ${c.name} pet-care market.`,
  (c, s) => `${s.name} looks different in ${c.name} than it does in a stock photo. The city's ${c.climate} sets the rhythm — hot months (${c.hot_season_months.join(', ')}) push serious walkers into the morning and late-evening slots, and cooler shoulders reopen the map. ${pick(c.pet_friendly_parks, slugHash(c.slug+s.slug+'2'))} is on almost every regular route around here. ${c.notes} That local nuance is the difference between a generic booking and one your pet actually looks forward to.`,
  (c, s) => `Good ${s.name.toLowerCase()} in ${c.name} starts with matching your ${s.provider_word} to the climate, the geography, and the neighborhood. ${c.climate.charAt(0).toUpperCase()+c.climate.slice(1)} means the hot months (${c.hot_season_months.join(', ')}) reshape the schedule. A regular route through ${pick(c.pet_friendly_parks, slugHash(c.slug+s.slug+'3'))} is one signal your provider knows the area. ${c.notes}`,
  (c, s) => `Every city has its own version of ${s.name.toLowerCase()}, and ${c.name}'s version bends around one fact: ${c.climate}. From ${c.hot_season_months[0]} onward, the walk window narrows. Locals who care about their dog's pads know ${pick(c.pet_friendly_parks, slugHash(c.slug+s.slug+'4'))} and cycle two or three routes through it depending on wind and time. ${c.notes} Ask any prospective ${s.provider_word} how they'd handle a peak-heat day and you'll learn most of what you need to know in two sentences.`,
  (c, s) => `${c.name} pet owners have specific asks of a ${s.provider_word} that owners three countries over don't. The ${c.climate} climate dictates the schedule; ${pick(c.pet_friendly_parks, slugHash(c.slug+s.slug+'5'))} anchors the regular route; local rules and habits fill in the rest. ${c.notes} A good ${s.name.toLowerCase()} booking respects all three, not just the calendar.`
];

const FACTOR_UP = [
  c => `Peak season demand (${c.hot_season_months.join(', ')} in ${c.name}) pushes prices toward the top of the range as walkers cap their books.`,
  c => `Neighborhoods with limited parking or gated access add setup time per visit, which shows up in ${c.name} rates.`,
  c => `Multi-pet households — two dogs, or a dog plus a cat visit stacked in one trip — carry a per-additional-pet fee almost everywhere in ${c.name}.`,
  c => `Holiday windows around ${c.name}'s calendar (public holidays, school breaks) command a 20–40% premium as availability tightens.`,
  c => `Anxious, reactive, or senior pets need slower onboarding — most ${c.name} providers price that as an extended first visit rather than a hidden surcharge.`
];
const FACTOR_DOWN = [
  c => `Recurring weekly bookings in ${c.name} typically drop the per-visit rate by 10–20% versus one-off walks.`,
  c => `Shorter slots (20–30 minutes) at midday cost less than full-hour bookings, especially in ${c.name} suburbs where drive time is short.`,
  c => `Small-group walks are the value tier in ${c.name} — cheaper than solo, but only if your dog is genuinely social.`,
  c => `Off-peak hours (${c.name}'s cooler months, or weekday mid-mornings) sit at the lower end of the local range.`,
  c => `Neighbors sharing a walker with a stacked schedule cuts each household's cost — a widely-used ${c.name} arrangement.`
];

const SAVING_TIPS = [
  c => `Book weekly slots on a rolling schedule instead of one-off requests — nearly every ${c.name} provider offers a package rate.`,
  c => `Bundle two services with the same provider (a walk plus a drop-in feed) and ask about a combined rate.`,
  c => `Avoid the ${c.hot_season_months[0]}–${c.hot_season_months[c.hot_season_months.length-1]} peak window when possible; shoulder months are cheaper and less oversubscribed.`,
  c => `Ask about small-group walks — cheaper than solo for social dogs and standard practice in ${c.name}.`,
  c => `Skip weekend and public-holiday premium slots; a Tuesday walk is materially cheaper.`
];

const FAQS_A = [
  (c, s) => ({ q: `How much does ${s.name.toLowerCase()} typically cost in ${c.name}?`, a: `Typical 2026 rates range ${rangeStr(rates[s.slug][c.cost_tier].min, rates[s.slug][c.cost_tier].max, c)} ${rates[s.slug][c.cost_tier].unit}. Ranges reflect duration, day of week, and how the provider structures their packages.` }),
  (c, s) => ({ q: `When are the best hours to book ${s.name.toLowerCase()} in ${c.name}?`, a: `Given ${c.name}'s ${c.climate}, the hot months (${c.hot_season_months.join(', ')}) push scheduled visits into cooler pockets — early morning and after sunset are the standard. Shoulder months open the day up.` }),
  (c, s) => ({ q: `What should I ask a ${s.provider_word} on their first visit in ${c.name}?`, a: `Ask which routes they use in your neighborhood, how they read heat, cold, or weather stress in a dog, and how they'd handle an emergency. A ${c.name} pro can name three routes and one nearest 24-hour vet without hesitation.` }),
  (c, s) => ({ q: `Are group walks common in ${c.name}?`, a: `Yes — small-group walks are widely available, priced below solo, and work well for social dogs. If your dog is reactive or recovering from injury, book solo and say why upfront.` }),
  (c, s) => ({ q: `${c.notes.replace(/\.$/,'')} — how does that affect my booking?`, a: `A ${c.name} provider working on OnlyPaw is briefed on this. Bring it up before the first visit so you're both aligned on route choice and timing.` })
];

const FAQS_B = [
  (c, s) => ({ q: `How much does ${s.name.toLowerCase()} cost in ${c.name}?`, a: `Typical 2026 rates range ${rangeStr(rates[s.slug][c.cost_tier].min, rates[s.slug][c.cost_tier].max, c)} ${rates[s.slug][c.cost_tier].unit}. This is a market range, not a quote — your final price depends on duration, frequency, and pet-specific needs.` }),
  (c, s) => ({ q: `Why is ${s.name.toLowerCase()} in ${c.name} priced the way it is?`, a: `${c.name} sits in the ${c.cost_tier} cost tier for pet-care services. Local wages, insurance costs, vehicle costs (for pet-taxi), and demand during ${c.hot_season_months.join(', ')} all feed into the range.` }),
  (c, s) => ({ q: `Are weekly packages cheaper in ${c.name}?`, a: `Almost always — booking a recurring weekly slot with the same ${s.provider_word} usually drops the per-visit rate by 10–20% versus a one-off booking.` }),
  (c, s) => ({ q: `Do ${c.name} providers charge extra for a second pet?`, a: `Yes, most do. Per-additional-pet fees are the norm here, and they cover the real additional time and attention required — not a padding charge.` }),
  (c, s) => ({ q: `Do holiday periods change the price in ${c.name}?`, a: `Yes. Public holidays and peak windows on the ${c.name} calendar carry a premium, typically 20–40%, because availability tightens sharply.` })
];

// ---------- checklist bullets ----------
function checklistBullets(city, service, seed) {
  const pool = [
    `Can name and use at least two routes through ${pick(city.pet_friendly_parks, seed)}, not just the nearest sidewalk.`,
    `Adjusts schedule around ${city.name}'s hot months (${city.hot_season_months.join(', ')}) rather than forcing a fixed slot.`,
    `Carries water and a collapsible bowl on every ${service.singular} in ${city.name} — non-negotiable in this climate.`,
    `Knows the nearest 24-hour emergency vet from your pickup point.`,
    `Reads paw-pad temperature by hand on hot surfaces before letting your dog step off the grass.`,
    `Sends real photo updates during the ${service.singular}, not a generic ‘all done’ text at the end.`,
    `Handles multi-pet households without stacking too many dogs on one leash.`,
    `Has a clear plan for weather cancellations — ${city.name}'s ${city.climate} makes that a real recurring question.`,
    `Comfortable with your building's access rules (fobs, gates, doormen) on day one.`,
    `Knows the difference between an anxious sniff-freeze and an aggressive lockup, and reads your dog before pushing forward.`
  ];
  const idx = new Set();
  let n = seed;
  while (idx.size < 5) { idx.add(n % pool.length); n = (n * 1103515245 + 12345) >>> 0; }
  return [...idx].map(i => pool[i]);
}

// ---------- head block ----------
function head({ title, description, canonical, ogImage }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta name="robots" content="index,follow,max-image-preview:large"/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="OnlyPaw"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:image" content="${DOMAIN}/assets/${ogImage || 'og.png'}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${DOMAIN}/assets/${ogImage || 'og.png'}"/>
<link rel="stylesheet" href="/assets/styles.css"/>
`;
}

// ---------- FAMILY A: service in city ----------
function renderFamilyA(city, service) {
  const canonical = `${DOMAIN}/pages/services/${service.slug}-in-${city.slug}.html`;
  const title = `${service.name} in ${city.name}, ${city.country} — Book Vetted ${service.provider_word.replace(/\b\w/g, l=>l.toUpperCase())}s | OnlyPaw`;
  const rateTier = rates[service.slug][city.cost_tier];
  const description = `Book a vetted ${service.provider_word} in ${city.name}. Typical 2026 rates ${rangeStr(rateTier.min, rateTier.max, city)} ${rateTier.unit}. Local, verified, insured.`.slice(0, 158);

  const seed = slugHash(city.slug + '|' + service.slug);
  const intro = pick(INTRO_TEMPLATES, seed)(city, service);
  const checklist = checklistBullets(city, service, seed);
  const faqs = FAQS_A.map(f => f(city, service));

  // cross-services (2 others in same city)
  const others = services.filter(s => s.slug !== service.slug).slice(0, 2);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": DOMAIN + "/" },
      { "@type": "ListItem", "position": 2, "name": "Services", "item": DOMAIN + "/pages/services/" },
      { "@type": "ListItem", "position": 3, "name": `${service.name} in ${city.name}`, "item": canonical }
    ]
  };
  const serviceLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    "serviceType": service.name,
    "name": `${service.name} in ${city.name}`,
    "description": description,
    "provider": { "@type": "Organization", "name": "OnlyPaw", "url": DOMAIN + "/" },
    "areaServed": [
      { "@type": "City", "name": city.name },
      { "@type": "Country", "name": city.country }
    ],
    "offers": {
      "@type": "AggregateOffer",
      "priceCurrency": city.currency,
      "lowPrice": toLocal(rateTier.min, city.currency),
      "highPrice": toLocal(rateTier.max, city.currency),
      "url": canonical
    },
    "url": canonical,
    "inLanguage": "en"
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } }))
  };

  const parks = city.pet_friendly_parks;

  const body = `<main class="post" style="max-width:860px;margin:0 auto;padding:32px 20px">
<nav aria-label="Breadcrumb" class="crumbs" style="font-size:13px;color:var(--muted);margin-bottom:12px">
  <a href="/">Home</a> › <a href="/pages/services/">Services</a> › <span>${esc(service.name)} in ${esc(city.name)}</span>
</nav>
<h1>${esc(service.name)} in ${esc(city.name)}, ${esc(city.country)}</h1>
<p class="meta">Typical 2026 range · ${esc(rangeStr(rateTier.min, rateTier.max, city))} ${esc(rateTier.unit)} · Vetted providers on OnlyPaw</p>

<section>
<p>${esc(intro)}</p>
</section>

<section style="background:#f6f7f9;border-radius:12px;padding:16px 20px;margin:24px 0">
<h2 style="margin-top:0">Typical 2026 rate range in ${esc(city.name)}</h2>
<p style="font-size:18px"><strong>${esc(rangeStr(rateTier.min, rateTier.max, city))}</strong> ${esc(rateTier.unit)} <span style="color:#666">(typical range, 2026 indicative)</span></p>
<p style="color:#555;font-size:14px">Local currency conversion uses 2026 reference rates. Your final quote depends on duration, frequency, and pet-specific needs.</p>
</section>

<section>
<h2>What a good ${esc(service.provider_word)} in ${esc(city.name)} looks like</h2>
<ul>
${checklist.map(b => `  <li>${esc(b)}</li>`).join('\n')}
</ul>
</section>

<section>
<h2>Popular ${service.slug === 'pet-taxi' ? 'pickup zones' : 'routes'} in ${esc(city.name)}</h2>
<p>Repeat customers in ${esc(city.name)} tend to build ${service.singular} schedules around these spots:</p>
<ul>
${parks.map(p => `  <li><strong>${esc(p)}</strong> — reliable option in most weather and a familiar landmark for local providers.</li>`).join('\n')}
</ul>
<p>${esc(city.notes)}</p>
</section>

<section>
<h2>Book a ${esc(service.provider_word)} in ${esc(city.name)}</h2>
<p><a class="cta-primary" href="/pages/signup-customer.html">Create your customer account</a> and search verified ${esc(service.provider_word)}s within your ${esc(city.name)} neighbourhood. Every provider on OnlyPaw is ID-verified, insurance-covered on every booking, and reviewed by real customers.</p>
</section>

<section>
<h2>Frequently asked questions</h2>
${faqs.map(f => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}
</section>

<section style="margin-top:48px;padding-top:24px;border-top:1px solid #eee">
<h3>Related</h3>
<ul>
  <li><a href="/pages/costs/${service.slug}-cost-in-${city.slug}.html">How much does ${esc(service.name.toLowerCase())} cost in ${esc(city.name)}?</a></li>
  <li><a href="/for-providers/${service.for_providers_slug}.html">Become a ${esc(service.provider_word)} on OnlyPaw</a></li>
${others.map(o => `  <li><a href="/pages/services/${o.slug}-in-${city.slug}.html">${esc(o.name)} in ${esc(city.name)}</a></li>`).join('\n')}
</ul>
</section>
</main>`;

  return head({ title, description, canonical, ogImage: 'og.png' })
    + jsonLd(serviceLd) + '\n'
    + jsonLd(breadcrumbLd) + '\n'
    + jsonLd(faqLd) + '\n'
    + `</head>\n<body>\n${topbar()}\n${body}\n${footer()}\n</body></html>\n`;
}

// ---------- rate tables per service ----------
function costTable(city, service) {
  const t = rates[service.slug][city.cost_tier];
  const fmt = (a, b) => `${rangeStr(a, b, city)}`;
  const rows = [];
  if (service.slug === 'dog-walking') {
    rows.push(['Per 30-minute walk', fmt(t.per_30min_min, t.per_30min_max)]);
    rows.push(['Per 60-minute walk', fmt(t.per_60min_min, t.per_60min_max)]);
    rows.push(['Weekly package (5×30 min)', fmt(t.weekly_min, t.weekly_max)]);
  } else if (service.slug === 'pet-boarding') {
    rows.push(['Per night', fmt(t.per_night_min, t.per_night_max)]);
    rows.push(['Per week', fmt(t.weekly_min, t.weekly_max)]);
    rows.push(['Holiday-window premium (per night)', fmt(t.holiday_min, t.holiday_max)]);
  } else if (service.slug === 'dog-daycare') {
    rows.push(['Half-day', fmt(t.half_day_min, t.half_day_max)]);
    rows.push(['Full day', fmt(t.full_day_min, t.full_day_max)]);
    rows.push(['Weekly (5 days)', fmt(t.weekly_min, t.weekly_max)]);
  } else if (service.slug === 'pet-sitting' || service.slug === 'cat-sitting') {
    rows.push(['Short drop-in visit (20–30 min)', fmt(t.short_visit_min, t.short_visit_max)]);
    rows.push(['Extended visit (45–60 min)', fmt(t.long_visit_min, t.long_visit_max)]);
    rows.push(['Weekly package', fmt(t.weekly_min, t.weekly_max)]);
  } else if (service.slug === 'pet-taxi') {
    rows.push(['Short ride (up to ~10 km)', fmt(t.short_ride_min, t.short_ride_max)]);
    rows.push(['Long ride (30 km+)', fmt(t.long_ride_min, t.long_ride_max)]);
    rows.push(['Per-km add-on', fmt(t.per_km_min, t.per_km_max)]);
  } else {
    rows.push(['Typical range', fmt(t.min, t.max)]);
  }
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0">
<thead><tr><th style="text-align:left;padding:8px;border-bottom:2px solid #eee">Booking type</th><th style="text-align:left;padding:8px;border-bottom:2px solid #eee">Typical 2026 range (${city.currency})</th></tr></thead>
<tbody>
${rows.map(r => `<tr><td style="padding:8px;border-bottom:1px solid #f0f0f0">${esc(r[0])}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0">${esc(r[1])}</td></tr>`).join('\n')}
</tbody></table>
<p style="font-size:13px;color:#666">Typical range, 2026 indicative — not a quote.</p>`;
}

// ---------- FAMILY B: cost pages ----------
function renderFamilyB(city, service) {
  const canonical = `${DOMAIN}/pages/costs/${service.slug}-cost-in-${city.slug}.html`;
  const rateTier = rates[service.slug][city.cost_tier];
  const range = rangeStr(rateTier.min, rateTier.max, city);
  const title = `How much does ${service.name.toLowerCase()} cost in ${city.name}? — 2026 rates | OnlyPaw`;
  const description = `${service.name} in ${city.name} typically ranges ${range} ${rateTier.unit} in 2026. Full rate table, price drivers, and how to save.`.slice(0, 158);

  const seed = slugHash(city.slug + '|cost|' + service.slug);

  // pick 3 unique up factors and 3 unique tips
  function pickN(arr, n, s) {
    const idx = new Set();
    let cur = s;
    while (idx.size < n) { idx.add(cur % arr.length); cur = (cur * 1103515245 + 12345) >>> 0; }
    return [...idx].map(i => arr[i]);
  }
  const drivers = pickN(FACTOR_UP, 3, seed).map(f => f(city));
  const tips = pickN(SAVING_TIPS, 3, seed + 7).map(f => f(city));
  const faqs = FAQS_B.map(f => f(city, service));

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": `How much does ${service.name.toLowerCase()} cost in ${city.name}? — 2026 rates`,
    "description": description,
    "author": { "@type": "Organization", "name": "OnlyPaw", "url": DOMAIN + "/" },
    "publisher": { "@type": "Organization", "name": "OnlyPaw", "logo": { "@type": "ImageObject", "url": DOMAIN + "/assets/logo.png" } },
    "datePublished": TODAY,
    "dateModified": TODAY,
    "mainEntityOfPage": canonical,
    "inLanguage": "en"
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": DOMAIN + "/" },
      { "@type": "ListItem", "position": 2, "name": "Costs", "item": DOMAIN + "/pages/costs/" },
      { "@type": "ListItem", "position": 3, "name": `${service.name} cost in ${city.name}`, "item": canonical }
    ]
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } }))
  };

  const body = `<main class="post" style="max-width:860px;margin:0 auto;padding:32px 20px">
<nav aria-label="Breadcrumb" class="crumbs" style="font-size:13px;color:var(--muted);margin-bottom:12px">
  <a href="/">Home</a> › <a href="/pages/costs/">Costs</a> › <span>${esc(service.name)} cost in ${esc(city.name)}</span>
</nav>
<h1>How much does ${esc(service.name.toLowerCase())} cost in ${esc(city.name)}?</h1>
<p class="meta">2026 typical range for ${esc(city.name)}, ${esc(city.country)} · Prepared by OnlyPaw · Updated ${esc(TODAY)}</p>

<section style="background:#eef6f2;border-radius:12px;padding:16px 20px;margin:16px 0">
<p style="margin:0;font-size:18px"><strong>${esc(service.name)} in ${esc(city.name)}: ${esc(range)} ${esc(rateTier.unit)}.</strong> This is the typical 2026 market range for the ${esc(city.cost_tier)} cost tier that ${esc(city.name)} sits in. Your actual booking price depends on duration, frequency, and pet-specific needs.</p>
</section>

<section>
<h2>2026 rate table for ${esc(city.name)}</h2>
${costTable(city, service)}
</section>

<section>
<h2>What drives ${esc(service.name.toLowerCase())} prices up or down in ${esc(city.name)}</h2>
<ul>
${drivers.map(d => `  <li>${esc(d)}</li>`).join('\n')}
</ul>
</section>

<section>
<h2>How to save without cutting corners</h2>
<ul>
${tips.map(t => `  <li>${esc(t)}</li>`).join('\n')}
</ul>
</section>

<section>
<h2>Frequently asked questions</h2>
${faqs.map(f => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}
</section>

<section style="margin-top:48px;padding-top:24px;border-top:1px solid #eee">
<h3>Related</h3>
<ul>
  <li><a href="/pages/services/${service.slug}-in-${city.slug}.html">${esc(service.name)} in ${esc(city.name)} — booking guide and provider checklist</a></li>
  <li><a href="/for-providers/earnings.html">How much can pet-care providers earn on OnlyPaw?</a></li>
  <li><a href="/pages/signup-customer.html">Book a verified ${esc(service.provider_word)} in ${esc(city.name)}</a></li>
</ul>
</section>
</main>`;

  return head({ title, description, canonical, ogImage: 'og.png' })
    + jsonLd(articleLd) + '\n'
    + jsonLd(breadcrumbLd) + '\n'
    + jsonLd(faqLd) + '\n'
    + `</head>\n<body>\n${topbar()}\n${body}\n${footer()}\n</body></html>\n`;
}

// ---------- HUB pages ----------
function renderHub(kind /* 'services' | 'costs' */) {
  const canonical = `${DOMAIN}/pages/${kind}/`;
  const title = kind === 'services'
    ? `Pet-care services near you — Dog walking, boarding, sitting in 90+ cities | OnlyPaw`
    : `Pet-care costs by city — 2026 rate guides for 90+ cities | OnlyPaw`;
  const description = kind === 'services'
    ? `Directory of vetted pet-care services in 90+ cities across North America, Europe, the Middle East, Asia and Latin America. Find a walker, sitter, boarder or pet taxi.`
    : `2026 pet-care price guides for 90+ cities — dog walking, pet sitting, boarding, daycare, cat sitting, and pet taxi. Local ranges, no filler.`;

  // group cities by region for readable directory
  const regions = {};
  for (const c of cities) {
    (regions[c.region] = regions[c.region] || []).push(c);
  }
  const regionOrder = ['North America', 'Europe', 'Oceania', 'Middle East', 'Asia', 'Latin America'];

  const sections = services.map(s => {
    const groups = regionOrder.filter(r => regions[r]).map(r => {
      const items = regions[r].map(c => {
        const href = kind === 'services'
          ? `/pages/services/${s.slug}-in-${c.slug}.html`
          : `/pages/costs/${s.slug}-cost-in-${c.slug}.html`;
        const label = kind === 'services'
          ? `${c.name}`
          : `${c.name}`;
        return `<li><a href="${href}">${esc(label)}</a></li>`;
      }).join('\n');
      return `<h3 style="margin-top:16px">${esc(r)}</h3><ul style="columns:2;column-gap:24px;list-style:none;padding:0">${items}</ul>`;
    }).join('\n');
    return `<section style="margin:32px 0"><h2>${esc(s.name)}</h2>${groups}</section>`;
  }).join('\n');

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": title,
    "description": description,
    "url": canonical,
    "inLanguage": "en",
    "isPartOf": { "@type": "WebSite", "name": "OnlyPaw", "url": DOMAIN + "/" }
  };

  const body = `<main class="post" style="max-width:1000px;margin:0 auto;padding:32px 20px">
<nav aria-label="Breadcrumb" class="crumbs" style="font-size:13px;color:var(--muted);margin-bottom:12px">
  <a href="/">Home</a> › <span>${kind === 'services' ? 'Services near you' : 'Pet-care costs by city'}</span>
</nav>
<h1>${kind === 'services' ? 'Pet-care services near you' : 'Pet-care costs by city'}</h1>
<p>${esc(description)}</p>
${sections}
</main>`;

  return head({ title, description, canonical })
    + jsonLd(collectionLd) + '\n'
    + `</head>\n<body>\n${topbar()}\n${body}\n${footer()}\n</body></html>\n`;
}

// ---------- write everything ----------
function write(dest, content) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

let countA = 0, countB = 0;
for (const city of cities) {
  for (const service of services) {
    write(path.join(OUT_SERVICES, `${service.slug}-in-${city.slug}.html`), renderFamilyA(city, service));
    countA++;
    write(path.join(OUT_COSTS, `${service.slug}-cost-in-${city.slug}.html`), renderFamilyB(city, service));
    countB++;
  }
}

write(path.join(OUT_SERVICES, 'index.html'), renderHub('services'));
write(path.join(OUT_COSTS, 'index.html'), renderHub('costs'));

// ---------- sitemap ----------
const preserved = [
  { loc: `${DOMAIN}/`, changefreq: 'weekly', priority: '1.0' },
  { loc: `${DOMAIN}/for-providers/`, changefreq: 'weekly', priority: '0.95' },
  { loc: `${DOMAIN}/for-providers/dog-walker.html`, changefreq: 'weekly', priority: '0.9' },
  { loc: `${DOMAIN}/for-providers/pet-sitter.html`, changefreq: 'weekly', priority: '0.9' },
  { loc: `${DOMAIN}/for-providers/pet-boarder.html`, changefreq: 'weekly', priority: '0.9' },
  { loc: `${DOMAIN}/for-providers/earnings.html`, changefreq: 'monthly', priority: '0.85' },
  { loc: `${DOMAIN}/for-providers/vs-rover.html`, changefreq: 'monthly', priority: '0.85' },
  { loc: `${DOMAIN}/pages/signup-customer.html`, changefreq: 'monthly', priority: '0.8' },
  { loc: `${DOMAIN}/pages/signup-provider.html`, changefreq: 'monthly', priority: '0.8' },
  { loc: `${DOMAIN}/pages/support.html`, changefreq: 'monthly', priority: '0.6' },
  { loc: `${DOMAIN}/blog/`, changefreq: 'weekly', priority: '0.8' },
  { loc: `${DOMAIN}/blog/posts/preparing-pet-for-first-boarding-stay.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/dog-walking-in-uae-summer.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/positive-reinforcement-basics.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/cat-grooming-at-home.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/pet-vaccinations-uae.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/pet-taxi-safety.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.75' },
  { loc: `${DOMAIN}/blog/posts/preparing-pet-for-first-boarding-stay-ar.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.7' },
  { loc: `${DOMAIN}/blog/posts/dog-walking-in-uae-summer-ar.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.7' },
  { loc: `${DOMAIN}/pages/terms.html`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${DOMAIN}/pages/privacy.html`, changefreq: 'yearly', priority: '0.3' }
];

function urlEntry(u) {
  const parts = [`  <url>`, `    <loc>${u.loc}</loc>`];
  if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
  if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
  if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
  parts.push(`  </url>`);
  return parts.join('\n');
}

const generated = [];
generated.push({ loc: `${DOMAIN}/pages/services/`, lastmod: TODAY, changefreq: 'weekly', priority: '0.75' });
generated.push({ loc: `${DOMAIN}/pages/costs/`, lastmod: TODAY, changefreq: 'weekly', priority: '0.75' });
for (const c of cities) for (const s of services) {
  generated.push({ loc: `${DOMAIN}/pages/services/${s.slug}-in-${c.slug}.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.6' });
  generated.push({ loc: `${DOMAIN}/pages/costs/${s.slug}-cost-in-${c.slug}.html`, lastmod: TODAY, changefreq: 'monthly', priority: '0.6' });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${preserved.concat(generated).map(urlEntry).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

console.log(`Family A pages: ${countA}`);
console.log(`Family B pages: ${countB}`);
console.log(`Hub pages: 2`);
console.log(`Sitemap URLs: ${preserved.length + generated.length}`);
