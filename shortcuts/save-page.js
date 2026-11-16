// Save to Recipes: the script for the Shortcut's "Run JavaScript on Web Page" action.
//
// It reads the recipe data that the page open in Safari carries about itself, and hands it to the
// Shortcut as one piece of text, ready to be written into the library's inbox. It reads this one page
// and nothing else, sends nothing anywhere itself, and changes nothing on the page.
//
// What it hands over is a "capture" (see docs/architecture.md), as base64 of plain JSON:
//   { v: 1, s: 2, url, title, site, at, ld: [the text of each ld+json block on the page],
//     groups: [{ name, items: [ingredient] }] }
// `s` is this script's version. Raise it here and in js/import/page.js (SCRIPT_VERSION) together.
// `groups` is how the page's layout groups its ingredients ("For the salsa"), which the data in ld
// never says. It is left out when the page shows no groups.
(function () {
  var SCRIPT = 2;
  var LIMIT = 700000;   // characters in all, so that one upload always fits
  var SPARE = 100000;   // how much of that may be data that does not mention a recipe

  function text(value) {
    return value == null ? '' : String(value);
  }

  function clean(value) {
    return text(value).replace(/\s+/g, ' ').trim();
  }

  // JSON in which every character outside plain ASCII is written as a \u escape, so btoa() takes it.
  function plain(value) {
    return JSON.stringify(value).replace(/[^ -~]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function meta(name) {
    var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? text(el.getAttribute('content')).trim() : '';
  }

  // The ld+json blocks on the page: those that mention a recipe, then the others.
  function blocks() {
    var all = document.querySelectorAll('script[type]');
    var out = { recipe: [], other: [] };
    for (var i = 0; i < all.length; i++) {
      if (!/^\s*application\/ld\+json/i.test(text(all[i].getAttribute('type')))) continue;
      var t = text(all[i].textContent).trim();
      if (t) (/recipe/i.test(t) ? out.recipe : out.other).push(t);
    }
    return out;
  }

  // Older pages describe the recipe in the page's own markup instead (schema.org microdata).
  // This turns that markup into the same kind of data, so the app reads both the same way.
  function ownerOf(el) {
    var up = el.parentElement;
    while (up && !up.hasAttribute('itemscope')) up = up.parentElement;
    return up;
  }

  function valueOf(el) {
    var held = el.getAttribute('content') || (el.tagName === 'TIME' ? el.getAttribute('datetime') : '');
    return text(held || el.innerText || el.textContent).trim();
  }

  // Some sites mark up everything except the steps. The part of the recipe whose name says it holds
  // the directions is read as the steps then.
  function looseSteps(root) {
    var box = root.querySelector('.e-instructions, [class*="directions"], [class*="instructions"]');
    var lines = box ? text(box.innerText || box.textContent).split(/\n+/) : [];
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line && !/^(directions?|instructions?|method|preparation|steps?)\s*:?$/i.test(line)) out.push(line);
    }
    return out;
  }

  function readItem(root) {
    var found = { name: '', recipeIngredient: [], recipeInstructions: [], totalTime: '', prepTime: '', cookTime: '', recipeYield: '' };
    var els = root.querySelectorAll('[itemprop]');
    for (var i = 0; i < els.length; i++) {
      if (ownerOf(els[i]) !== root) continue;   // it belongs to something inside the recipe, such as its author
      var value = valueOf(els[i]);
      if (!value) continue;
      var names = text(els[i].getAttribute('itemprop')).split(/\s+/);
      for (var n = 0; n < names.length; n++) {
        var name = names[n];
        if (name === 'recipeIngredient' || name === 'ingredients') found.recipeIngredient.push(value);
        else if (name === 'recipeInstructions') found.recipeInstructions.push(value);
        else if (typeof found[name] === 'string' && !found[name]) found[name] = value;
      }
    }
    if (!found.recipeInstructions.length) found.recipeInstructions = looseSteps(root);
    return found;
  }

  function microdata() {
    var roots = document.querySelectorAll('[itemtype]');
    var best = null;
    var bestSize = 0;
    for (var i = 0; i < roots.length; i++) {
      if (!/(^|\s)https?:\/\/schema\.org\/Recipe\/?(\s|$)/i.test(text(roots[i].getAttribute('itemtype')))) continue;
      var found = readItem(roots[i]);
      var size = found.recipeIngredient.length + found.recipeInstructions.length + (found.name ? 1 : 0);
      if (size > bestSize) { best = found; bestSize = size; }
    }
    if (!best) return '';
    var data = { '@context': 'https://schema.org', '@type': 'Recipe' };
    for (var key in best) if (best[key] && best[key].length) data[key] = best[key];
    return JSON.stringify(data);
  }

  // ---------- how the page's layout groups the ingredients ----------
  //
  // The page's data lists the ingredients in one flat run. The page itself often shows them under
  // headings: "For the chicken", "For the salsa". To find those, each ingredient in the data is looked
  // up on the page by its words, and the heading that comes before it there is the name of its group.
  // Nothing here knows about any one site.

  var HEAD = 59;        // a line longer than this is a sentence, not a heading
  var LINE = 300;       // characters kept from one ingredient
  var NEED = 0.8;       // the share of the ingredients that must be found on the page
  // Words over a list that do not say what the ingredients under them are for.
  var PLAIN_WHOLE = /^(the )?(ingredients?( list)?|what you( wi|')?ll need|what you need|you( wi|')?ll need|shopping list|method|directions?|instructions?|preparation|notes?|equipment|nutrition)$/;
  var PLAIN_START = /^(serves|servings?|makes|yields?)\b|^(prep|cook|total|active)( time)?\s*:?\s*\d|^(units?|scale|metric|us customary|cook mode|print|share|save|rate|pin|jump to)\b/;
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|IMG|SVG|IFRAME|VIDEO|NAV|FORM)$/;
  var CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']+', 'g');
  var NOT_WORD;
  try { NOT_WORD = new RegExp('[^\\p{L}\\p{N}]+', 'gu'); } catch (err) { NOT_WORD = /[^a-z0-9]+/g; }
  // The names HTML gives to characters 160 to 255, in that order, all in lower case.
  var LATIN = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute ' +
    'micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest agrave aacute acirc atilde auml aring aelig ccedil ' +
    'egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml times oslash ugrave uacute ' +
    'ucirc uuml yacute thorn szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute ' +
    'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');

  function fromCode(code) {
    try {
      return code > 31 && code < 1114112 ? String.fromCodePoint(code) : ' ';
    } catch (err) {
      return ' ';
    }
  }

  // A line with only its letters and digits left, in lower case. The same ingredient gives the same
  // result whether it comes from the page's data ("&frac12; cup  milk") or from the page itself.
  function wordsOf(value) {
    return text(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x([0-9a-f]{1,6});/gi, function (whole, hex) { return fromCode(parseInt(hex, 16)); })
      .replace(/&#(\d{1,7});/g, function (whole, digits) { return fromCode(parseInt(digits, 10)); })
      .replace(/&([a-z][a-z0-9]{1,9});/gi, function (whole, name) {
        var at = LATIN.indexOf(name.toLowerCase());
        return at < 0 ? ' ' : String.fromCharCode(160 + at);
      })
      .toLowerCase().replace(NOT_WORD, ' ').trim();
  }

  function tagOf(el) {
    return text(el.tagName).toUpperCase();
  }

  function inside(el, holder) {
    while (el) {
      if (el === holder) return true;
      el = el.parentElement;
    }
    return false;
  }

  function depthOf(el) {
    var depth = 0;
    while (el.parentElement) { el = el.parentElement; depth++; }
    return depth;
  }

  // Whether anything inside `el` passes `test`. Looks at a limited number of elements.
  function some(el, test) {
    var left = 80;
    function look(node) {
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        if (--left < 0) return false;
        if (test(kids[i]) || look(kids[i])) return true;
      }
      return false;
    }
    return look(el);
  }

  // One ld+json block as data, with the same repairs the app's reader makes. Null when it will not parse.
  function parseBlock(raw) {
    var t = text(raw).trim().replace(/^<!--/, '').replace(/-->$/, '')
      .replace(/^(\/\/\s*)?<!\[CDATA\[/, '').replace(/(\/\/\s*)?\]\]>$/, '').trim().replace(/;$/, '');
    var spaced = t.replace(CONTROL, ' ');
    var tries = [t, spaced, spaced.replace(/,\s*([\]}])/g, '$1')];
    for (var i = 0; i < tries.length; i++) {
      try {
        return JSON.parse(tries[i]);
      } catch (err) { /* try the next form */ }
    }
    return null;
  }

  // The ingredient lines of the fullest recipe in the page's data.
  function dataLines(ld) {
    var best = [];
    var seen = 0;
    function isRecipe(node) {
      var types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      for (var i = 0; i < types.length; i++) {
        if (typeof types[i] === 'string' && /(^|[\/#:])recipe$/i.test(types[i].trim())) return true;
      }
      return false;
    }
    function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 24 || ++seen > 20000) return;
      var i;
      if (Array.isArray(value)) {
        for (i = 0; i < value.length; i++) walk(value[i], depth + 1);
        return;
      }
      if (isRecipe(value)) {
        var list = Array.isArray(value.recipeIngredient) ? value.recipeIngredient : value.ingredients;
        var lines = [];
        if (Array.isArray(list)) {
          for (i = 0; i < list.length && lines.length < 300; i++) {
            if (typeof list[i] === 'string' && wordsOf(list[i])) lines.push(list[i]);
          }
        }
        if (lines.length > best.length) best = lines;
      }
      for (var name in value) {
        if (Object.prototype.hasOwnProperty.call(value, name)) walk(value[name], depth + 1);
      }
    }
    for (var b = 0; b < ld.length; b++) walk(parseBlock(ld[b]), 0);
    return best;
  }

  // Every element on the page whose words are one of the wanted lines: words -> elements, in page order.
  function findLines(want) {
    var have = {};
    function look(list, limit, leafy) {
      for (var n = 0; n < list.length && n < limit; n++) {
        var el = list[n];
        if (leafy && el.children && el.children.length > 8) continue;
        var raw = text(el.textContent);
        if (raw.length < 2 || raw.length > 600) continue;
        var words = ' ' + wordsOf(raw);
        if (!want[words]) continue;
        var got = have[words] || (have[words] = []);
        if (got.length && inside(el, got[got.length - 1])) continue;   // the same line again, one layer in
        got.push(el);
      }
    }
    look(document.querySelectorAll('li'), 4000, false);
    var missing = false;
    for (var words in want) if (!have[words] || have[words].length < want[words]) missing = true;
    // Not every page puts its ingredients in a list.
    if (missing) look(document.querySelectorAll('p, td, dd, dt, label, span, div'), 8000, true);
    return have;
  }

  // The part of the page the ingredients sit in: the deepest element that holds at least four in five
  // of them. A line whose words also turned up somewhere else on the page falls outside it.
  function areaOf(els) {
    var tried = [];
    var best = null;
    var bestDepth = -1;
    var need = Math.ceil(els.length * NEED);
    for (var i = 0; i < els.length && i < 60; i++) {
      for (var up = els[i].parentElement; up; up = up.parentElement) {
        if (tried.indexOf(up) >= 0) break;   // everything above it has been tried as well
        tried.push(up);
        var count = 0;
        for (var j = 0; j < els.length; j++) if (inside(els[j], up)) count++;
        if (count < need) continue;
        var depth = depthOf(up);
        if (depth > bestDepth) { best = up; bestDepth = depth; }
        break;                               // anything above holds them too, and is less deep
      }
    }
    return best;
  }

  function isBold(el) {
    try {
      if (typeof getComputedStyle !== 'function') return false;
      var weight = getComputedStyle(el).fontWeight;
      return weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
    } catch (err) {
      return false;
    }
  }

  function labelOf(el) {
    return clean(el.textContent).replace(/\s*:+$/, '');
  }

  // The words of a heading, or '' when `el` is not one. A heading is an h1 to h6, or a short line of
  // its own that is bold or is named as a heading or group. `holders` are the elements that have
  // ingredients somewhere inside them.
  function headingOf(el, holders) {
    var tag = tagOf(el);
    if (SKIP.test(tag)) return '';
    var label = labelOf(el);
    if (label.length < 2 || label.length > HEAD || !wordsOf(label)) return '';
    var lower = label.toLowerCase();
    if (PLAIN_WHOLE.test(lower) || PLAIN_START.test(lower)) return '';
    if (el.offsetParent === null) return '';   // not shown on the page
    if (some(el, function (x) { return /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(tagOf(x)); })) return '';
    if (/^H[1-6]$/.test(tag)) return label;
    var parent = el.parentElement;
    var alone = !parent || holders.indexOf(parent) >= 0 || labelOf(parent) === label;   // not part of a longer line
    if (/^(STRONG|B|DT|LEGEND)$/.test(tag)) return alone ? label : '';
    if (/group|heading|header|title|subhead/i.test(text(el.getAttribute('class')))) return label;
    if (some(el, function (x) { return /^(H[1-6]|STRONG|B)$/.test(tagOf(x)) && labelOf(x) === label; })) return label;
    return alone && isBold(el) ? label : '';
  }

  // [{ name, items }] in the order of the page, or [] when the page shows no groups.
  function layoutGroups(ld) {
    var lines = dataLines(ld);
    if (lines.length < 2) return [];
    var want = {};
    var i;
    for (i = 0; i < lines.length; i++) want[' ' + wordsOf(lines[i])] = (want[' ' + wordsOf(lines[i])] || 0) + 1;
    var have = findLines(want);

    // First the element that comes first for each line, then the part of the page most of them share.
    var taken = {};
    var els = [];
    var firsts = [];
    for (i = 0; i < lines.length; i++) {
      var words = ' ' + wordsOf(lines[i]);
      var nth = taken[words] || 0;
      taken[words] = nth + 1;
      els.push(have[words] && have[words][nth] ? have[words][nth] : null);
      if (els[i]) firsts.push(els[i]);
    }
    if (firsts.length < lines.length * NEED) return [];
    var area = areaOf(firsts);
    if (!area || /^(BODY|HTML)$/.test(tagOf(area))) return [];

    // A line found outside that part is looked for again inside it.
    var used = [];
    for (i = 0; i < lines.length; i++) if (els[i] && inside(els[i], area)) used.push(els[i]);
    var matched = 0;
    for (i = 0; i < lines.length; i++) {
      if (els[i] && !inside(els[i], area)) {
        var others = have[' ' + wordsOf(lines[i])] || [];
        els[i] = null;
        for (var o = 0; o < others.length; o++) {
          if (inside(others[o], area) && used.indexOf(others[o]) < 0) { els[i] = others[o]; used.push(others[o]); break; }
        }
      }
      if (els[i]) matched++;
    }
    if (matched < lines.length * NEED) return [];

    var holders = [];
    for (i = 0; i < els.length; i++) {
      for (var up = els[i] ? els[i].parentElement : null; up; up = up.parentElement) {
        if (holders.indexOf(up) < 0) holders.push(up);
        if (up === area) break;
      }
    }

    // Down the page in order: a heading starts a group, and each ingredient joins the group it is under.
    var groups = [{ name: '', items: [] }];
    var waiting = null;   // a heading that has been passed, with no ingredient under it yet
    var visited = 0;
    var tooBig = false;
    function walk(el) {
      var kids = el.children || [];
      for (var k = 0; k < kids.length && !tooBig; k++) {
        var kid = kids[k];
        if (++visited > 3000) { tooBig = true; return; }
        var at = els.indexOf(kid);
        if (at >= 0) {
          if (waiting !== null) { groups.push({ name: waiting, items: [] }); waiting = null; }
          groups[groups.length - 1].items.push(clean(lines[at]).slice(0, LINE));
        } else if (holders.indexOf(kid) >= 0) {
          walk(kid);
        } else {
          var name = headingOf(kid, holders);
          if (name) waiting = name;
          else walk(kid);   // a heading can sit a layer or two inside something that is not one
        }
      }
    }
    walk(area);
    if (tooBig) return [];

    var out = [];
    var named = 0;
    for (i = 0; i < groups.length && out.length < 40; i++) {
      if (!groups[i].items.length) continue;
      out.push(groups[i]);
      if (groups[i].name) named++;
    }
    // One heading over everything says nothing about what belongs to what.
    return named && out.length > 1 ? out : [];
  }

  function bare() {
    return { v: 1, s: SCRIPT, url: text(location.href), title: text(document.title), at: new Date().toISOString(), ld: [] };
  }

  var capture;
  try {
    capture = bare();
    var site = meta('og:site_name');
    if (site) capture.site = site.slice(0, 200);

    var found = blocks();
    var used = 0;
    var typed = false;   // a block that really holds something of the type Recipe
    var i, size;
    for (i = 0; i < found.recipe.length; i++) {
      size = plain(found.recipe[i]).length;
      if (used + size > LIMIT) continue;
      capture.ld.push(found.recipe[i]);
      used += size;
      if (/"@type"\s*:\s*(\[[^\]]*)?"(https?:\/\/schema\.org\/)?Recipe"/i.test(found.recipe[i])) typed = true;
    }
    if (!typed) {
      var marked = microdata();
      size = marked ? plain(marked).length : 0;
      if (marked && used + size <= LIMIT) { capture.ld.push(marked); used += size; }
    }

    // The groups come before the data that is only there to spare: they are small and worth more.
    try {
      var groups = layoutGroups(capture.ld);
      size = groups.length ? plain(groups).length : 0;
      if (groups.length && size <= 60000 && used + size <= LIMIT) { capture.groups = groups; used += size; }
    } catch (err) { /* no groups, then: the recipe itself still gets through */ }

    var spare = 0;
    for (i = 0; i < found.other.length; i++) {
      size = plain(found.other[i]).length;
      if (spare + size > SPARE || used + size > LIMIT) continue;
      capture.ld.push(found.other[i]);
      spare += size;
      used += size;
    }
  } catch (err) {
    capture = null;
  }

  // Whatever went wrong above, the address and the title still get through.
  var out = '';
  try {
    out = btoa(plain(capture || bare()));
  } catch (err) {
    try {
      out = btoa(plain({ v: 1, s: SCRIPT, url: text(location.href), title: '', ld: [] }));
    } catch (again) {
      out = btoa('{"v":1,"s":' + SCRIPT + ',"url":"","title":"","ld":[]}');
    }
  }
  completion(out);
})();
