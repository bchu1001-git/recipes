// Save to Recipes: the script for the Shortcut's "Run JavaScript on Webpage" action.
//
// It reads the recipe data that the page open in Safari carries about itself, and hands it to the
// Shortcut as one piece of text, ready to be written into the library's inbox. It reads this one page
// and nothing else, sends nothing anywhere itself, and changes nothing on the page.
//
// What it hands over is a "capture" (see docs/architecture.md), as base64 of plain JSON:
//   { v: 1, url, title, site, at, ld: [the text of each ld+json block on the page] }
(function () {
  var LIMIT = 700000;   // characters in all, so that one upload always fits
  var SPARE = 100000;   // how much of that may be data that does not mention a recipe

  function text(value) {
    return value == null ? '' : String(value);
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

  function bare() {
    return { v: 1, url: text(location.href), title: text(document.title), at: new Date().toISOString(), ld: [] };
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
      out = btoa(plain({ v: 1, url: text(location.href), title: '', ld: [] }));
    } catch (again) {
      out = btoa('{"v":1,"url":"","title":"","ld":[]}');
    }
  }
  completion(out);
})();
