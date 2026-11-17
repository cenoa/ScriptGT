/*
 * BuildHelper : fenêtre de gestion pour Guerres Tribales
 * ------------------------------------------------------
 * Le script ouvre une petite fenêtre et s'y installe. Cette fenêtre reste
 * active quand la page du jeu change : elle relit la page à chaque
 * chargement et se met à jour toute seule.
 *
 * Elle permet de :
 *   - changer de village (liste + flèches) ; le jeu suit
 *   - voir les constructions et les formations en cours
 *     (caserne, écurie et atelier ont chacun leur propre file)
 *   - gérer les BÂTIMENTS : plan de construction + urgences
 *     (entrepôt ou ferme presque pleins)
 *   - gérer les TROUPES : équilibrer, sinon recruter davantage
 *     (ratio pop des soldats / points du village)
 *
 * Rien n'est validé sans ton clic. Pour le recrutement, la fenêtre ouvre la
 * bonne page et saisit la quantité : c'est toi qui cliques sur "Recruter".
 *
 * Structure :
 *   1. CONFIG    : tes réglages (plan de construction, rôles, noms...)
 *   2. LA FENÊTRE : tout le code qui tourne dans la fenêtre
 *        a. lecture du jeu    d. affichage
 *        b. décisions         e. actions (construire / recruter / village)
 *        c. état et mise à jour
 *   3. LANCEMENT : ouvre la fenêtre et y installe le code
 */
(function () {
  'use strict';

  /* =================================================================
   * 1. CONFIG : tes réglages
   * ================================================================= */
  const Config = {
    // --- Plan de construction ---------------------------------------
    // Liste d'étapes [bâtiment, niveau à atteindre], dans l'ordre.
    // Le script propose la première étape pas encore atteinte (en comptant
    // les constructions déjà en cours). Un bâtiment absent du monde est
    // ignoré. C'est un plan de départ : modifie-le librement.
    buildOrder: [
      ['wood', 5], ['stone', 5], ['iron', 5], ['main', 5], ['farm', 5], ['storage', 5],
      ['main', 10], ['barracks', 5], ['wood', 10], ['stone', 10], ['iron', 10],
      ['farm', 10], ['storage', 10],
      ['smith', 5], ['stable', 5], ['market', 5], ['barracks', 10], ['main', 15],
      ['wood', 15], ['stone', 15], ['iron', 15], ['farm', 15], ['storage', 15],
      ['wall', 5], ['hide', 5],
      ['stable', 10], ['smith', 10], ['barracks', 15], ['main', 20],
      ['wood', 20], ['stone', 20], ['iron', 20], ['farm', 20], ['storage', 20],
      ['barracks', 20], ['stable', 15], ['smith', 15], ['market', 10], ['wall', 10],
      ['wood', 25], ['stone', 25], ['iron', 25], ['farm', 25], ['storage', 25],
      ['barracks', 25], ['stable', 20], ['smith', 20], ['wall', 15],
      ['wood', 30], ['stone', 30], ['iron', 30], ['farm', 30], ['storage', 30],
    ],

    // Urgences : si une ressource atteint 90 % de l'entrepôt, ou si la
    // population atteint 90 % de la ferme, on propose d'abord de les agrandir
    // (jusqu'à ces niveaux maximum).
    fullRatio: 0.9,
    emergencyMax: { storage: 30, farm: 30 },

    // --- Troupes ------------------------------------------------------
    offUnits: ['axe', 'light', 'marcher', 'ram', 'catapult'],
    defUnits: ['spear', 'sword', 'archer', 'heavy'],

    // Village "Off" si au moins 80 % de sa population militaire (off + def)
    // est offensive, "Def" si au moins 80 % est défensive, sinon "Mixte".
    roleShare: 0.8,

    // Rôle utilisé quand le village n'a aucune troupe
    defaultRole: 'def',

    // Paires d'unités à équilibrer (le premier = unité par défaut)
    balance: { off: ['axe', 'light'], def: ['spear', 'sword'] },

    // Écart toléré entre les deux unités (part de leur population totale)
    balanceTolerance: 0.1,

    // Unités ignorées dans le calcul de la pop des soldats
    ratioIgnore: ['spy'],

    // Ratio pop des soldats / points du village : en dessous, on propose
    // de recruter. 0.7 est une valeur de départ à ajuster.
    minPopPerPoint: 0.7,

    // --- Divers -------------------------------------------------------
    trainBuildings: ['barracks', 'stable', 'garage'], // chacun a sa propre file
    autoRefreshSeconds: 60, // mise à jour automatique si la page ne change pas

    // --- Noms affichés (si un nom manque, le nom interne est affiché) ---
    buildingLabels: {
      main: 'Quartier général', barracks: 'Caserne', stable: 'Écurie',
      garage: 'Atelier', church: 'Église', church_f: 'Première église',
      watchtower: 'Tour de guet', snob: 'Académie', smith: 'Forge',
      place: 'Place de ralliement', statue: 'Statue', market: 'Marché',
      wood: 'Camp de bois', stone: "Carrière d'argile", iron: 'Mine de fer',
      farm: 'Ferme', storage: 'Entrepôt', hide: 'Cachette', wall: 'Muraille',
    },
    unitLabels: {
      spear: 'Lancier', sword: 'Épéiste', axe: 'Hache', archer: 'Archer',
      spy: 'Éclaireur', light: 'Cavalerie légère', marcher: 'Archer monté',
      heavy: 'Cavalerie lourde', ram: 'Bélier', catapult: 'Catapulte',
      knight: 'Paladin', snob: 'Noble',
    },

    // Population (place dans la ferme) de chaque unité
    unitPop: {
      spear: 1, sword: 1, axe: 1, archer: 1, spy: 2, light: 4,
      marcher: 5, heavy: 6, ram: 5, catapult: 8, knight: 10, snob: 100,
    },

    // Bâtiment où l'on recrute chaque unité
    unitBuilding: {
      spear: 'barracks', sword: 'barracks', axe: 'barracks', archer: 'barracks',
      spy: 'stable', light: 'stable', marcher: 'stable', heavy: 'stable',
      ram: 'garage', catapult: 'garage',
    },
  };

  /* =================================================================
   * 2. LA FENÊTRE : ce code tourne DANS la fenêtre ouverte
   *    (window.opener = la fenêtre du jeu qui l'a ouverte)
   * ================================================================= */
  function popupMain(Config) {
    'use strict';
    window.__bhRunning = true;
    if (window.__bhTimer) clearInterval(window.__bhTimer);

    /* ---------- petits outils ---------- */
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const digits = (v) => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bLabel = (b) => Config.buildingLabels[b] || b;
    const uLabel = (u) => Config.unitLabels[u] || u;
    const fmt = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('fr-FR'));
    const roleNames = { off: 'Off', def: 'Def', mixte: 'Mixte', vide: 'Aucune troupe' };

    /* ---------- état de la fenêtre ---------- */
    const state = {
      snap: null,         // infos du village affiché dans le jeu
      buildQueue: [],     // constructions en cours [{name, time}]
      buildable: {},      // "bâtiment:niveau" -> true si constructible
      train: {},          // file de chaque bâtiment militaire (null = non construit)
      troops: {},         // troupes présentes dans le village
      villages: [],       // liste des villages [{id, label}]
      villagesLoaded: false,
      mode: 'buildings',  // 'buildings' ou 'troops'
      pending: null,      // action en attente de la prochaine page
      lastLoadId: null,   // identifiant du chargement actuel de la page du jeu
      updatedAt: 0, busy: false, dirty: false,
      log: [], start: Date.now(),
    };

    const log = (msg) => {
      state.log.unshift(new Date().toLocaleTimeString() + '  ' + msg);
      state.log = state.log.slice(0, 30);
      const box = $('log');
      if (box) box.innerHTML = state.log.map(esc).join('<br>');
    };

    /* =================================================================
     * a. LECTURE DU JEU
     * ================================================================= */

    // La fenêtre du jeu (null si elle est fermée)
    const getGame = () => {
      try { const w = window.opener; return w && !w.closed ? w : null; } catch (e) { return null; }
    };
    const getGD = () => {
      const w = getGame();
      try { return w && w.game_data && w.game_data.village ? w.game_data : null; } catch (e) { return null; }
    };

    // Change à chaque chargement de page : sert à repérer un rechargement
    const pageId = () => { const w = getGame(); try { return w ? w.performance.timeOrigin : null; } catch (e) { return null; } };

    // Adresse d'un écran du jeu pour un village donné
    const gameUrl = (screen, villageId) => {
      const gd = getGD();
      return getGame().location.origin + gd.link_base_pure.replace(/village=\d+/, 'village=' + villageId) + screen;
    };
    const navigate = (screen, villageId) => { getGame().location.href = gameUrl(screen, villageId); };

    // Télécharge un écran du jeu et le transforme en document lisible
    const fetchDoc = async (screen, villageId) => {
      const res = await fetch(gameUrl(screen, villageId), { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' (' + screen + ')');
      return new DOMParser().parseFromString(await res.text(), 'text/html');
    };

    // Infos du village actuellement affiché dans le jeu (lecture immédiate,
    // sans requête) : game_data + en-tête de la page.
    const readSnapshot = () => {
      const gd = getGD();
      if (!gd) return null;
      const v = gd.village;
      const d = getGame().document;
      const dom = (id) => { const e = d.getElementById(id); return e ? digits(e.textContent) : null; };
      const pick = (a, b) => { const n = digits(a); return n !== null ? n : b; };
      const levels = {};
      Object.keys(v.buildings || {}).forEach((k) => { levels[k] = parseInt(v.buildings[k], 10) || 0; });
      return {
        id: parseInt(v.id, 10), name: v.name, screen: gd.screen,
        points: digits(v.points) || 0,
        levels: levels,
        wood: pick(v.wood, dom('wood')), stone: pick(v.stone, dom('stone')), iron: pick(v.iron, dom('iron')),
        storage: pick(v.storage_max, dom('storage')),
        pop: pick(v.pop, dom('pop_current_label')), popMax: pick(v.pop_max, dom('pop_max_label')),
        units: gd.units || [],
      };
    };

    // Constructions en cours (écran "main") : lignes #buildqueue .buildorder_<bâtiment>
    // À VÉRIFIER avec l'inspecteur si la liste reste vide alors qu'une construction tourne.
    const parseBuildQueue = (doc) => {
      const list = [];
      doc.querySelectorAll('#buildqueue tr[class*="buildorder_"]').forEach((row) => {
        const m = row.className.match(/buildorder_(\w+)/);
        if (!m) return;
        const t = row.querySelector('[class*="timer"]');
        list.push({ name: m[1], time: t ? t.textContent.trim() : '' });
      });
      return list;
    };

    // Boutons "Construire" actifs sur l'écran "main"
    const parseBuildable = (doc) => {
      const ok = {};
      doc.querySelectorAll('a.btn-build').forEach((a) => {
        if (a.classList.contains('inactive')) return;
        ok[a.getAttribute('data-building') + ':' + a.getAttribute('data-level-next')] = true;
      });
      return ok;
    };

    // Troupes présentes : champ #unit_input_<unité>, attribut data-all-count
    const parseTroops = (doc, units) => {
      const t = {};
      units.forEach((u) => {
        const el = doc.getElementById('unit_input_' + u);
        const c = el ? parseInt(el.getAttribute('data-all-count'), 10) : 0;
        if (c > 0) t[u] = c;
      });
      return t;
    };

    // File de formation d'un bâtiment militaire : #trainqueue_wrap_<bâtiment>
    // À VÉRIFIER avec l'inspecteur si une formation en cours n'apparaît pas.
    const parseTrainQueue = (doc, building, units) => {
      const list = [];
      const wrap = doc.getElementById('trainqueue_wrap_' + building);
      if (!wrap) return list;
      wrap.querySelectorAll('tr').forEach((row) => {
        if (row.querySelector('th')) return; // ligne d'en-tête
        const first = row.querySelector('td');
        const count = first ? parseInt(first.textContent.trim(), 10) : NaN;
        if (isNaN(count)) return; // pas une ligne de formation
        const unit = units.find((u) => row.querySelector('.' + u + ', img[src*="unit_' + u + '"]'));
        const t = row.querySelector('[class*="timer"]');
        list.push({ unit: unit || null, count: count, time: t ? t.textContent.trim() : '' });
      });
      return list;
    };

    // Liste des villages du joueur : éléments .quickedit-vn (data-id) + libellé
    const parseVillageList = (doc) => {
      const list = [];
      const seen = {};
      doc.querySelectorAll('.quickedit-vn').forEach((span) => {
        const id = parseInt(span.getAttribute('data-id'), 10);
        if (!id || seen[id]) return;
        seen[id] = true;
        const lab = span.querySelector('.quickedit-label');
        list.push({ id: id, label: (lab || span).textContent.trim().replace(/\s+/g, ' ') });
      });
      return list;
    };

    /* =================================================================
     * b. DÉCISIONS (fonctions pures : elles ne touchent pas au jeu)
     * ================================================================= */

    // Niveau réel = niveau construit + constructions en cours
    const effectiveLevels = (levels, queue) => {
      const eff = Object.assign({}, levels);
      queue.forEach((q) => { if (q.name in eff) eff[q.name] += 1; });
      return eff;
    };

    // Propositions de construction (urgences d'abord, puis le plan).
    // Renvoie jusqu'à `count` propositions [{building, from, to, reason}].
    const planBuildings = (snap, eff, count) => {
      const sim = Object.assign({}, eff);
      const out = [];
      const exists = (b) => Object.prototype.hasOwnProperty.call(sim, b);
      const add = (b, reason) => { out.push({ building: b, from: sim[b], to: sim[b] + 1, reason: reason }); sim[b] += 1; };

      // Urgence 1 : entrepôt presque plein
      const maxRes = Math.max(snap.wood || 0, snap.stone || 0, snap.iron || 0);
      if (snap.storage && maxRes >= snap.storage * Config.fullRatio && exists('storage') && sim.storage < Config.emergencyMax.storage) {
        add('storage', 'Entrepôt presque plein (' + fmt(maxRes) + ' / ' + fmt(snap.storage) + ').');
      }
      // Urgence 2 : ferme presque pleine
      if (snap.popMax && snap.pop >= snap.popMax * Config.fullRatio && exists('farm') && sim.farm < Config.emergencyMax.farm) {
        add('farm', 'Ferme presque pleine (' + fmt(snap.pop) + ' / ' + fmt(snap.popMax) + ').');
      }
      // Plan : première étape pas encore atteinte, et ainsi de suite
      while (out.length < count) {
        const step = Config.buildOrder.find((s) => exists(s[0]) && sim[s[0]] < s[1]);
        if (!step) break;
        add(step[0], 'Plan : ' + bLabel(step[0]) + ' niveau ' + step[1] + '.');
      }
      return out;
    };

    // Rôle du village d'après la part offensive / défensive
    const analyseTroops = (troops) => {
      let off = 0;
      let def = 0;
      Config.offUnits.forEach((u) => { off += (troops[u] || 0) * Config.unitPop[u]; });
      Config.defUnits.forEach((u) => { def += (troops[u] || 0) * Config.unitPop[u]; });
      const total = off + def;
      let role;
      if (total === 0) role = 'vide';
      else if (off / total >= Config.roleShare) role = 'off';
      else if (def / total >= Config.roleShare) role = 'def';
      else role = 'mixte';
      return { off: off, def: def, role: role };
    };

    // Ratio : pop des soldats (sans éclaireurs) / points du village
    const computeRatio = (troops, points) => {
      let pop = 0;
      Object.keys(troops).forEach((u) => {
        if (Config.ratioIgnore.indexOf(u) === -1) pop += troops[u] * (Config.unitPop[u] || 0);
      });
      if (!(points > 0)) return null;
      const ratio = pop / points;
      return {
        points: points, pop: pop, ratio: ratio,
        low: ratio < Config.minPopPerPoint,
        missing: Math.max(0, Math.ceil(Config.minPopPerPoint * points - pop)),
      };
    };

    // Proposition de recrutement : 1) équilibrer la paire d'unités (si les
    // deux existent déjà), 2) sinon recruter davantage si le ratio est faible.
    // Renvoie null s'il n'y a aucune raison de recruter.
    const chooseRecruit = (totals, analysis, ratioInfo) => {
      let side = analysis.role;
      if (side === 'vide') side = Config.defaultRole;
      else if (side === 'mixte') side = analysis.off < analysis.def ? 'off' : 'def';

      const pair = Config.balance[side];
      const present = pair.filter((u) => (totals[u] || 0) > 0);
      const reasons = [];
      let unit = pair[0];
      let quantity = null;

      if (analysis.role === 'vide') reasons.push('Aucune troupe dans le village.');

      if (present.length === 1) {
        unit = present[0]; // une seule unité existe : on continue avec elle
      } else if (present.length === 2) {
        const popA = totals[pair[0]] * Config.unitPop[pair[0]];
        const popB = totals[pair[1]] * Config.unitPop[pair[1]];
        const diff = Math.abs(popA - popB);
        const weaker = popA <= popB ? pair[0] : pair[1];
        unit = weaker;
        const qty = Math.round(diff / Config.unitPop[weaker]);
        if (qty >= 1 && diff / (popA + popB) > Config.balanceTolerance) {
          quantity = qty;
          reasons.push('Équilibrage ' + uLabel(pair[0]) + ' / ' + uLabel(pair[1]) +
            ' : il manque environ ' + qty + ' ' + uLabel(weaker) + '.');
        }
      }

      if (ratioInfo && ratioInfo.low) {
        reasons.push('Ratio pop / points faible : il manque environ ' + fmt(ratioInfo.missing) + ' pop de soldats.');
      }
      if (reasons.length === 0) return null;
      return { side: side, unit: unit, quantity: quantity, reasons: reasons, building: Config.unitBuilding[unit] };
    };

    // Troupes présentes + troupes en formation, rôle et ratio
    const derive = () => {
      const queued = {};
      Config.trainBuildings.forEach((b) => {
        (state.train[b] || []).forEach((q) => { if (q.unit) queued[q.unit] = (queued[q.unit] || 0) + q.count; });
      });
      const totals = Object.assign({}, state.troops);
      Object.keys(queued).forEach((u) => { totals[u] = (totals[u] || 0) + queued[u]; });
      return {
        queued: queued, totals: totals, analysis: analyseTroops(totals),
        ratio: state.snap ? computeRatio(totals, state.snap.points) : null,
      };
    };

    /* =================================================================
     * c. ÉTAT ET MISE À JOUR
     * ================================================================= */

    // Relit tout pour le village affiché dans le jeu (plusieurs requêtes,
    // l'une après l'autre pour ne pas surcharger le serveur).
    const refresh = async () => {
      if (state.busy) { state.dirty = true; return; }
      state.busy = true;
      try {
        const snap = readSnapshot();
        if (!snap) throw new Error('page du jeu illisible');
        state.snap = snap;
        renderAll();

        const main = await fetchDoc('main', snap.id);
        state.buildQueue = parseBuildQueue(main);
        state.buildable = parseBuildable(main);

        await sleep(250);
        state.troops = parseTroops(await fetchDoc('place', snap.id), snap.units);

        for (const b of Config.trainBuildings) {
          if (!(snap.levels[b] > 0)) { state.train[b] = null; continue; } // non construit
          await sleep(250);
          state.train[b] = parseTrainQueue(await fetchDoc(b, snap.id), b, snap.units);
        }
        state.updatedAt = Date.now();
      } catch (e) {
        log('Erreur de mise à jour : ' + e.message);
      }
      state.busy = false;
      renderAll();
      if (state.dirty) { state.dirty = false; refresh(); }
    };

    const loadVillages = async () => {
      try {
        const id = parseInt(getGD().village.id, 10);
        let list = parseVillageList(await fetchDoc('overview_villages&mode=prod&page=-1', id));
        if (!list.length) list = parseVillageList(await fetchDoc('overview_villages', id));
        state.villages = list;
        log(list.length ? list.length + ' villages trouvés.' : 'Liste des villages illisible : seul le village actuel est proposé.');
      } catch (e) {
        log('Erreur liste des villages : ' + e.message);
      }
      renderAll();
    };

    /* =================================================================
     * d. AFFICHAGE
     * ================================================================= */
    const queueText = (q) => {
      if (q === null) return 'non construit(e)';
      if (!q.length) return 'libre';
      return q.map((x) => x.count + ' ' + (x.unit ? uLabel(x.unit) : '?') + (x.time ? ' (' + x.time + ')' : '')).join(', ');
    };

    const renderHeader = () => {
      const s = state.snap;
      if (!s) return '<div>Lecture de la page du jeu…</div>';
      const list = state.villages.some((v) => v.id === s.id) ? state.villages : [{ id: s.id, label: s.name }].concat(state.villages);
      const options = list.map((v) => '<option value="' + v.id + '"' + (v.id === s.id ? ' selected' : '') + '>' + esc(v.label) + '</option>').join('');
      const full = (n) => (s.storage && n >= s.storage * Config.fullRatio ? ' class="warn"' : '');
      const popWarn = s.popMax && s.pop >= s.popMax * Config.fullRatio ? ' class="warn"' : '';
      return `
        <div>
          <button data-action="prevVillage" title="Village précédent">◀</button>
          <select id="villageSelect">${options}</select>
          <button data-action="nextVillage" title="Village suivant">▶</button>
          <button data-action="refresh" title="Actualiser">↻</button>
        </div>
        <div style="margin-top:4px">Points : <b>${fmt(s.points)}</b> · page du jeu : ${esc(s.screen)}</div>
        <div>Bois <span${full(s.wood)}>${fmt(s.wood)}</span> ·
             Argile <span${full(s.stone)}>${fmt(s.stone)}</span> ·
             Fer <span${full(s.iron)}>${fmt(s.iron)}</span> / entrepôt ${fmt(s.storage)}</div>
        <div>Ferme : <span${popWarn}>${fmt(s.pop)} / ${fmt(s.popMax)}</span></div>`;
    };

    const renderStatus = () => {
      const bq = state.buildQueue.length
        ? state.buildQueue.map((q) => esc(bLabel(q.name)) + (q.time ? ' (' + esc(q.time) + ')' : '')).join(', ')
        : 'aucune';
      const train = Config.trainBuildings
        .map((b) => '<div>' + esc(bLabel(b)) + ' : ' + esc(queueText(state.train[b] === undefined ? [] : state.train[b])) + '</div>')
        .join('');
      return `<div class="box">
        <b>En cours</b>
        <div>Constructions : ${bq}</div>
        ${train}
        <div style="font-size:11px">${state.updatedAt ? 'mis à jour à ' + new Date(state.updatedAt).toLocaleTimeString() : 'mise à jour en cours…'}</div>
      </div>`;
    };

    const renderBuildings = () => {
      const s = state.snap;
      if (!s) return '';
      const eff = effectiveLevels(s.levels, state.buildQueue);
      const props = planBuildings(s, eff, 5);
      const first = props[0];
      const rows = Object.keys(s.levels).map((b) => {
        const q = eff[b] - s.levels[b];
        return '<tr class="' + (first && first.building === b ? 'cur' : '') + '"><td>' + esc(bLabel(b)) + '</td><td>' +
          s.levels[b] + (q ? ' (+' + q + ')' : '') + '</td></tr>';
      }).join('');

      let proposal;
      if (!first) {
        proposal = 'Plan terminé : rien à proposer.';
      } else {
        const known = Object.keys(state.buildable).length > 0;
        const ok = state.buildable[first.building + ':' + first.to];
        const availability = !known ? '' : ok
          ? '<div>✓ constructible maintenant</div>'
          : '<div class="warn">✗ pas constructible maintenant (ressources, file pleine ou prérequis)</div>';
        // Si la première proposition n'est pas constructible maintenant, on
        // signale la première des suivantes qui l'est.
        const alt = known && !ok ? props.slice(1).find((p) => state.buildable[p.building + ':' + p.to]) : null;
        const altBlock = alt
          ? `<div style="margin-top:6px">Constructible à la place : <b>${esc(bLabel(alt.building))}</b> niveau ${alt.from} → ${alt.to}
             <div style="margin-top:4px"><button data-action="build" data-building="${esc(alt.building)}" data-level="${alt.to}">Construire</button></div></div>`
          : '';
        const next = props.slice(1, 4).map((p) => '• ' + esc(bLabel(p.building)) + ' → ' + p.to).join('<br>');
        proposal = `Proposition : <b>${esc(bLabel(first.building))}</b> niveau ${first.from} → ${first.to}
          <div>${esc(first.reason)}</div>${availability}
          <div style="margin-top:4px"><button data-action="build" data-building="${esc(first.building)}" data-level="${first.to}">Construire</button></div>
          ${altBlock}
          ${next ? '<div style="margin-top:4px;font-size:11px">Ensuite :<br>' + next + '</div>' : ''}`;
      }
      return `<div class="box">${proposal}</div>
        <h4>Bâtiments du monde</h4><table>${rows}</table>`;
    };

    const renderTroops = () => {
      const s = state.snap;
      if (!s) return '';
      const d = derive();
      const units = Object.keys(d.totals);
      const rows = units.map((u) =>
        '<tr><td>' + esc(uLabel(u)) + '</td><td>' + (state.troops[u] || 0) + '</td><td>' + (d.queued[u] || 0) + '</td><td>' + d.totals[u] + '</td></tr>'
      ).join('');
      const table = rows
        ? '<table><tr><td></td><td><b>Présentes</b></td><td><b>En formation</b></td><td><b>Total</b></td></tr>' + rows + '</table>'
        : 'Aucune troupe.';

      const r = d.ratio;
      const ratioLine = r
        ? 'Pop soldats / points : <b>' + r.ratio.toFixed(2) + '</b>' + (r.low ? ' <span class="warn">⚠ faible</span>' : '') +
          '<br><small>' + fmt(r.pop) + ' pop (sans éclaireurs, formations comprises) / ' + fmt(r.points) + ' pts</small>'
        : 'Pop soldats / points : indisponible';

      const rec = chooseRecruit(d.totals, d.analysis, r);
      let proposal;
      if (!rec) {
        proposal = 'Troupes équilibrées et ratio correct : rien à recruter pour le moment.';
      } else {
        const q = state.train[rec.building];
        let note = '';
        if (q === null) note = '<div class="warn">⚠ ' + esc(bLabel(rec.building)) + ' non construit(e) : recrutement impossible ici.</div>';
        else if (q && q.length) note = '<div>ℹ ' + esc(bLabel(rec.building)) + ' occupé(e) : ' + esc(queueText(q)) + '</div>';
        const button = q === null ? '' :
          '<div style="margin-top:4px"><button data-action="recruit" data-unit="' + esc(rec.unit) + '" data-qty="' + (rec.quantity || 0) +
          '">Préparer le recrutement</button></div>';
        proposal = rec.reasons.map((x) => '• ' + esc(x)).join('<br>') +
          '<div style="margin-top:4px">Proposition : <b>' + esc(uLabel(rec.unit)) + '</b>' + (rec.quantity ? ' (environ ' + rec.quantity + ')' : '') + '</div>' +
          note + button;
      }
      return `<div class="box">Village : <b>${roleNames[d.analysis.role]}</b><br>${ratioLine}</div>
        <div class="box">${proposal}</div>
        <h4>Troupes</h4>${table}
        <div style="font-size:11px;margin-top:4px">Seules les troupes présentes au village sont comptées.</div>`;
    };

    const renderAll = () => {
      const tab = (mode, label) => '<button data-action="mode" data-mode="' + mode + '" class="' + (state.mode === mode ? 'active' : '') + '">' + label + '</button>';
      const pending = state.pending ? '<div class="box">⏳ Action en attente de la prochaine page du jeu…</div>' : '';
      // On ne redessine pas la liste des villages pendant qu'elle est ouverte
      $('app').innerHTML = renderHeader() + renderStatus() + pending +
        '<div style="margin-top:8px"><b>Que veux-tu gérer ?</b> ' + tab('buildings', 'Bâtiments') + ' ' + tab('troops', 'Troupes') + '</div>' +
        (state.mode === 'buildings' ? renderBuildings() : renderTroops());
    };

    /* =================================================================
     * e. ACTIONS (toujours déclenchées par un clic de ta part)
     * ================================================================= */

    // Aller dans un autre village : le jeu navigue, la fenêtre suit
    const switchVillage = (id) => {
      const gd = getGD();
      if (!gd || id === parseInt(gd.village.id, 10)) return;
      state.pending = null;
      const keep = ['overview', 'main', 'barracks', 'stable', 'garage', 'place', 'market', 'smith', 'train'];
      log('Changement de village…');
      navigate(keep.indexOf(gd.screen) !== -1 ? gd.screen : 'overview', id);
    };
    const stepVillage = (dir) => {
      const gd = getGD();
      if (!gd || !state.villages.length) { log('Liste des villages indisponible.'); return; }
      const cur = state.villages.findIndex((v) => v.id === parseInt(gd.village.id, 10));
      const next = state.villages[(cur + dir + state.villages.length) % state.villages.length];
      switchVillage(next.id);
    };

    // Exécute l'action en attente quand la bonne page est affichée
    const execPending = () => {
      const p = state.pending;
      const gd = getGD();
      if (!p || !gd) return;
      state.pending = null;
      const w = getGame();
      const onVillage = parseInt(gd.village.id, 10) === p.village;

      if (p.type === 'build') {
        if (!onVillage || gd.screen !== 'main') { log('Construction annulée : page inattendue.'); return; }
        // Le vrai bouton "Construire" du jeu (repéré avec data-building / data-level-next)
        const btn = Array.from(w.document.querySelectorAll('a.btn-build')).find((a) =>
          a.getAttribute('data-building') === p.building &&
          a.getAttribute('data-level-next') === String(p.level) &&
          !a.classList.contains('inactive') && a.getClientRects().length > 0);
        if (!btn) { log('Impossible de construire ' + bLabel(p.building) + ' (ressources insuffisantes ou file pleine).'); return; }
        btn.click();
        log('Construction lancée : ' + bLabel(p.building) + ' niveau ' + p.level + '.');
        setTimeout(refresh, 2500);
      } else if (p.type === 'recruit') {
        const okScreen = gd.screen === Config.unitBuilding[p.unit] || gd.screen === 'train';
        if (!onVillage || !okScreen) { log('Recrutement annulé : page inattendue.'); return; }
        const doc = w.document;
        const input = doc.querySelector('input[name="' + p.unit + '"]') ||
          doc.querySelector('input[name="units[' + p.unit + ']"]') || doc.getElementById(p.unit + '_0');
        if (!input) { log('Champ de recrutement introuvable : saisis la quantité de ' + uLabel(p.unit) + ' à la main.'); return; }
        input.value = p.qty > 0 ? String(p.qty) : '';
        input.dispatchEvent(new w.Event('input', { bubbles: true }));
        input.dispatchEvent(new w.Event('change', { bubbles: true }));
        input.focus();
        log(p.qty > 0 ? 'Quantité saisie : ' + p.qty + ' ' + uLabel(p.unit) + '. Clique sur Recruter dans le jeu.'
                      : 'Page de recrutement ouverte : choisis la quantité de ' + uLabel(p.unit) + '.');
      }
      renderAll();
    };

    const startBuild = (building, level) => {
      const s = state.snap;
      if (!s) return;
      state.pending = { type: 'build', village: s.id, building: building, level: level };
      const gd = getGD();
      if (gd && gd.screen === 'main' && parseInt(gd.village.id, 10) === s.id) {
        execPending(); // déjà sur le bâtiment principal : on clique tout de suite
      } else {
        log('Ouverture du bâtiment principal…');
        navigate('main', s.id);
        renderAll();
      }
    };

    const startRecruit = (unit, qty) => {
      const s = state.snap;
      if (!s) return;
      state.pending = { type: 'recruit', village: s.id, unit: unit, qty: qty };
      log('Ouverture de ' + bLabel(Config.unitBuilding[unit]) + '…');
      navigate(Config.unitBuilding[unit], s.id);
      renderAll();
    };

    /* ---------- clics et boucle principale ---------- */
    document.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t) return;
      const a = t.getAttribute('data-action');
      if (a === 'refresh') { refresh(); loadVillages(); }
      else if (a === 'mode') { state.mode = t.getAttribute('data-mode'); renderAll(); }
      else if (a === 'prevVillage') stepVillage(-1);
      else if (a === 'nextVillage') stepVillage(1);
      else if (a === 'build') startBuild(t.getAttribute('data-building'), parseInt(t.getAttribute('data-level'), 10));
      else if (a === 'recruit') startRecruit(t.getAttribute('data-unit'), parseInt(t.getAttribute('data-qty'), 10) || 0);
    });
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'villageSelect') switchVillage(parseInt(e.target.value, 10));
    });

    const tick = () => {
      const up = $('up');
      if (up) up.textContent = Math.round((Date.now() - state.start) / 1000);

      const w = getGame();
      const status = $('status');
      if (!w) { if (status) status.textContent = '⚠ Fenêtre du jeu introuvable (fermée ?)'; return; }
      if (status) status.textContent = '';

      // La page du jeu est-elle prête ?
      let ready = false;
      try { ready = !!(w.game_data && w.game_data.village && w.document.readyState === 'complete'); } catch (e) { ready = false; }
      if (!ready) return;

      const id = pageId();
      if (id !== state.lastLoadId) {
        // Nouvelle page du jeu (ou premier passage)
        state.lastLoadId = id;
        const gd = getGD();
        log('Page du jeu : ' + gd.screen + ' (' + gd.village.name + ')');
        state.snap = readSnapshot();
        if (state.pending) execPending();
        if (!state.villagesLoaded) { state.villagesLoaded = true; loadVillages(); }
        refresh();
      } else if (!state.busy && Date.now() - state.updatedAt > Config.autoRefreshSeconds * 1000) {
        refresh();
      }
    };

    window.__bhTimer = setInterval(tick, 1000);
    // Pour le dépannage : window.__bh dans la console de CETTE fenêtre
    window.__bh = { state: state, planBuildings: planBuildings, chooseRecruit: chooseRecruit, analyseTroops: analyseTroops, computeRatio: computeRatio, parse: { parseBuildQueue, parseTrainQueue, parseVillageList, parseTroops } };
    tick();
  }

  /* =================================================================
   * 3. LANCEMENT : ouvre la fenêtre et y installe le code
   * ================================================================= */
  // Le nom 'bhPanel' fait que relancer le script retrouve la même fenêtre
  const win = window.open('', 'bhPanel', 'width=430,height=780');
  if (!win) {
    alert('Fenêtre bloquée : autorise les pop-ups pour ce site, puis relance.');
    return;
  }
  // Déjà ouverte et active : on la remet simplement au premier plan
  if (win.__bhRunning && win.opener && !win.opener.closed) {
    win.focus();
    return;
  }

  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>BuildHelper</title>
    <style>
      body { font: 12px sans-serif; background: #f4e4bc; margin: 0; padding: 8px; }
      h4 { margin: 10px 0 4px; }
      table { width: 100%; border-collapse: collapse; }
      td { border-bottom: 1px solid #d9c391; padding: 2px 4px; }
      .cur td { font-weight: bold; background: #e7d098; }
      button, select { font-size: 12px; }
      .active { font-weight: bold; background: #e7d098; }
      .warn { color: #c00; font-weight: bold; }
      .box { background: #fff5da; border: 1px solid #7d510f; padding: 6px; margin-top: 6px; }
      #log { font-size: 11px; max-height: 130px; overflow-y: auto; }
    </style></head><body>
    <div id="status" class="warn"></div>
    <div id="app">Chargement…</div>
    <h4>Journal</h4><div id="log"></div>
    <div style="margin-top:6px;font-size:11px">Fenêtre ouverte depuis <span id="up">0</span> s</div>
  </body></html>`);
  win.document.close();

  // Le code et la config sont copiés dans la fenêtre, où ils tournent
  const script = win.document.createElement('script');
  script.textContent = '(' + popupMain.toString() + ')(' + JSON.stringify(Config) + ');';
  win.document.body.appendChild(script);
})();