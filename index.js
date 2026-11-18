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
 *   - gérer les BÂTIMENTS : le moins cher d'abord, mines équilibrées,
 *     quartier général si il va plus vite, urgences entrepôt / ferme
 *   - gérer les TROUPES : équilibrer, sinon recruter davantage
 *     (ratio pop des soldats / points du village)
 *   - gérer la FORGE : améliorer les troupes du rôle du village
 *   - bouton "Suivant" : bâtiments -> troupes -> forge -> village suivant
 *   - APERÇU de tous les villages : constructions, caserne, écurie, atelier
 *     (objectif : que tout tourne en continu sur chaque village)
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
    // --- Bâtiments ----------------------------------------------------
    // Niveau maximum voulu pour chaque bâtiment. Un bâtiment absent de cette
    // liste (ou absent du monde) n'est jamais proposé (sauf urgences).
    targets: {
      main: 20, barracks: 25, stable: 20, smith: 20, market: 10,
      wood: 30, stone: 30, iron: 30, farm: 30, storage: 30,
      wall: 15, hide: 10,
    },

    // Mines à équilibrer : une seule est candidate, la moins avancée
    mines: ['wood', 'stone', 'iron'],

    // Le script choisit en général le bâtiment le MOINS CHER (bois + argile +
    // fer). Ce coefficient ajuste le coût "ressenti" : en dessous de 1 le
    // bâtiment est favorisé, au-dessus de 1 il est retardé (défaut : 1).
    weights: { wood: 0.8, stone: 0.8, iron: 0.8, market: 1.3, wall: 1.5, hide: 1.5 },

    // Urgences : entrepôt si une ressource atteint 90 % de sa capacité (ou
    // s'il est trop petit pour le prochain bâtiment), ferme si la population
    // atteint 90 % de sa capacité. Niveaux maximum pour ces urgences :
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

    // Ce qui doit tourner en continu (l'atelier est optionnel : il n'est pas
    // dans la liste, donc jamais signalé comme "à relancer")
    required: ['construction', 'barracks', 'stable'],

    // Aperçu des villages : analyser aussi l'atelier ? (1 requête de plus par village)
    scanGarage: true,
    autoRefreshSeconds: 120, // mise à jour automatique si la page ne change pas

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
      buildInfo: {},      // coûts et durées par bâtiment (écran "main")
      smith: undefined,   // techniques recherchables (null = pas de forge)
      data: {},           // dernier état connu de chaque village : {buildQueue, train, updatedAt}
      currentId: null,    // village affiché (sert à repérer un changement de village)
      scanning: false, stop: false, scanDone: 0,
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

    // "0:12:34" -> secondes (null si ce n'est pas une durée)
    const timeToSeconds = (txt) => {
      const m = String(txt).trim().match(/^(\d+):(\d{2}):(\d{2})$/);
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    };
    const fmtTime = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const r = sec % 60;
      return h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    };

    // Coûts et durée du PROCHAIN niveau de chaque bâtiment (écran "main") :
    // lignes #main_buildrow_<bâtiment>, cellules .cost_wood / .cost_stone /
    // .cost_iron (attribut data-cost), la durée est la cellule au format h:mm:ss.
    // À VÉRIFIER avec l'inspecteur si les coûts restent illisibles.
    const parseBuildInfo = (doc) => {
      const info = {};
      doc.querySelectorAll('tr[id^="main_buildrow_"]').forEach((row) => {
        const name = row.id.replace('main_buildrow_', '');
        const cost = (res) => {
          const c = row.querySelector('.cost_' + res);
          if (!c) return null;
          const dc = c.getAttribute('data-cost');
          return digits(dc !== null ? dc : c.textContent);
        };
        const wood = cost('wood');
        const stone = cost('stone');
        const iron = cost('iron');
        let time = null;
        row.querySelectorAll('td').forEach((td) => {
          const t = timeToSeconds(td.textContent);
          if (t !== null && time === null) time = t;
        });
        const btn = row.querySelector('a.btn-build');
        info[name] = {
          wood: wood, stone: stone, iron: iron,
          total: wood !== null && stone !== null && iron !== null ? wood + stone + iron : null,
          time: time,
          hasButton: !!btn,
          active: !!btn && !btn.classList.contains('inactive'),
        };
      });
      return info;
    };

    // Techniques recherchables à la forge : liens ...action=research&id=<unité>
    // À VÉRIFIER avec l'inspecteur si la forge ne propose rien alors qu'une
    // amélioration est possible.
    const parseResearch = (doc) => {
      const list = [];
      const seen = {};
      doc.querySelectorAll('a[href*="action=research"]').forEach((a) => {
        const m = (a.getAttribute('href') || '').match(/[?&]id=(\w+)/);
        if (!m || seen[m[1]]) return;
        seen[m[1]] = true;
        list.push({ unit: m[1], active: !a.classList.contains('inactive'), text: a.textContent.trim() });
      });
      return list;
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

    // Comme parseTrainQueue, mais sait distinguer "libre" (le formulaire de
    // recrutement existe) de "non construit / illisible" (null).
    // Utilisé pour les autres villages, dont on ne connaît pas les niveaux.
    const parseTrainState = (doc, building, units) => {
      if (doc.getElementById('trainqueue_wrap_' + building)) return parseTrainQueue(doc, building, units);
      if (doc.querySelector('input[id$="_0"], #train_form, form[action*="train"]')) return [];
      return null;
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

    // Propositions de construction, de la plus importante à la moins importante :
    //   1. Urgences : entrepôt (presque plein, ou trop petit pour le meilleur
    //      candidat), puis ferme (presque pleine)
    //   2. Quartier général, s'il se construit plus vite que le meilleur
    //      candidat (il raccourcit ensuite toutes les constructions)
    //   3. Le reste, du moins cher au plus cher (coût x coefficient), avec une
    //      seule mine candidate : la moins avancée
    // info = coûts et durées lus sur la page du bâtiment principal.
    const planBuildings = (snap, eff, info, count) => {
      const out = [];
      const used = {};
      const push = (b, reason) => {
        if (used[b]) return;
        used[b] = true;
        out.push({ building: b, from: eff[b], to: eff[b] + 1, reason: reason });
      };
      const has = (b) => Object.prototype.hasOwnProperty.call(eff, b);
      const wanted = (b) => has(b) && Config.targets[b] !== undefined && eff[b] < Config.targets[b];

      // Candidats : bâtiments voulus dont on connaît le coût
      let cands = Object.keys(eff).filter((b) => wanted(b) && info[b] && info[b].total !== null);

      // Une seule mine : la moins avancée (à égalité, la moins chère)
      const mines = cands.filter((b) => Config.mines.indexOf(b) !== -1);
      if (mines.length > 1) {
        mines.sort((a, b) => eff[a] - eff[b] || info[a].total - info[b].total);
        cands = cands.filter((b) => Config.mines.indexOf(b) === -1 || b === mines[0]);
      }

      // Classement : d'abord ceux qui ont un bouton "Construire" (sinon le
      // prérequis manque), puis du moins cher au plus cher
      const score = (b) => info[b].total * (Config.weights[b] || 1);
      cands.sort((a, b) => {
        if (info[a].hasButton !== info[b].hasButton) return info[a].hasButton ? -1 : 1;
        return score(a) - score(b);
      });
      const best = cands[0] || null;

      // 1. Urgences
      const canGrow = (b) => has(b) && eff[b] < Config.emergencyMax[b];
      const maxRes = Math.max(snap.wood || 0, snap.stone || 0, snap.iron || 0);
      const bestMaxCost = best ? Math.max(info[best].wood || 0, info[best].stone || 0, info[best].iron || 0) : 0;
      if (canGrow('storage') && snap.storage) {
        if (maxRes >= snap.storage * Config.fullRatio) {
          push('storage', 'Urgent : entrepôt presque plein (' + fmt(maxRes) + ' / ' + fmt(snap.storage) + ').');
        } else if (bestMaxCost > snap.storage) {
          push('storage', "Urgent : l'entrepôt est trop petit pour " + bLabel(best) +
            ' (coût ' + fmt(bestMaxCost) + ' > ' + fmt(snap.storage) + ').');
        }
      }
      if (canGrow('farm') && snap.popMax && snap.pop >= snap.popMax * Config.fullRatio) {
        push('farm', 'Urgent : ferme presque pleine (' + fmt(snap.pop) + ' / ' + fmt(snap.popMax) + ').');
      }

      // 2. Quartier général plus rapide que le meilleur candidat
      if (best && best !== 'main' && wanted('main') && info.main && info.main.time !== null &&
          info[best].time !== null && info.main.time < info[best].time) {
        push('main', 'Quartier général : ' + fmtTime(info.main.time) + ' contre ' + fmtTime(info[best].time) +
          ' pour ' + bLabel(best) + ', et il accélère les constructions suivantes.');
      }

      // 3. Le reste, du moins cher au plus cher
      cands.forEach((b) => {
        push(b, (Config.mines.indexOf(b) !== -1 ? 'Mines équilibrées : la moins avancée. ' : '') +
          'Coût : ' + fmt(info[b].total) + ' ressources.');
      });

      return out.slice(0, count);
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
        // Pas d'écart à combler : on propose de combler la pop manquante
        // (la quantité sera limitée au maximum possible au moment de la saisie)
        if (quantity === null) quantity = Math.max(1, Math.ceil(ratioInfo.missing / Config.unitPop[unit]));
      }
      if (reasons.length === 0) return null;
      return { side: side, unit: unit, quantity: quantity, reasons: reasons, building: Config.unitBuilding[unit] };
    };

    // Liste de ce qui ne tourne pas dans un village (d = {buildQueue, train}) :
    // seulement les éléments de Config.required. Ce qui est inconnu
    // (non lu, non construit) n'est pas signalé.
    const idleOf = (d) => {
      const out = [];
      if (Config.required.indexOf('construction') !== -1 && d.buildQueue && d.buildQueue.length === 0) out.push('Construction');
      Config.trainBuildings.forEach((b) => {
        if (Config.required.indexOf(b) !== -1 && d.train && Array.isArray(d.train[b]) && d.train[b].length === 0) out.push(bLabel(b));
      });
      return out;
    };

    // Forge : on améliore les troupes du rôle du village, parmi celles qu'on
    // possède (formations comprises), les plus nombreuses (en pop) d'abord.
    // Aucune troupe = rien à améliorer. Village mixte : on suit le côté dominant.
    const planSmith = (analysis, totals, techs) => {
      if (analysis.role === 'vide') return { message: 'Aucune troupe : rien à améliorer.' };
      const side = analysis.role === 'mixte' ? (analysis.off >= analysis.def ? 'off' : 'def') : analysis.role;
      const pool = side === 'off' ? Config.offUnits : Config.defUnits;
      const owned = pool.filter((u) => (totals[u] || 0) > 0)
        .sort((a, b) => totals[b] * Config.unitPop[b] - totals[a] * Config.unitPop[a]);
      const candidates = owned.map((u) => techs.find((t) => t.unit === u)).filter(Boolean);
      if (!candidates.length) {
        return { side: side, message: 'Aucune amélioration disponible pour tes troupes ' +
          (side === 'off' ? 'offensives' : 'défensives') + ' (déjà au maximum, ou forge insuffisante).' };
      }
      const first = candidates.find((t) => t.active) || candidates[0];
      return { side: side, candidates: candidates, first: first };
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
        // Autre village que lors de la dernière lecture : on repart de zéro,
        // pour ne pas afficher les files de l'ancien village
        if (state.currentId !== snap.id) {
          state.currentId = snap.id;
          state.buildQueue = []; state.buildable = {}; state.buildInfo = {};
          state.train = {}; state.troops = {}; state.smith = undefined; state.updatedAt = 0;
        }
        state.snap = snap;
        renderAll();

        const main = await fetchDoc('main', snap.id);
        state.buildQueue = parseBuildQueue(main);
        state.buildable = parseBuildable(main);
        state.buildInfo = parseBuildInfo(main);

        await sleep(250);
        state.troops = parseTroops(await fetchDoc('place', snap.id), snap.units);

        for (const b of Config.trainBuildings) {
          if (!(snap.levels[b] > 0)) { state.train[b] = null; continue; } // non construit
          await sleep(250);
          state.train[b] = parseTrainQueue(await fetchDoc(b, snap.id), b, snap.units);
        }
        if (snap.levels.smith > 0) {
          await sleep(250);
          state.smith = parseResearch(await fetchDoc('smith', snap.id));
        } else {
          state.smith = null; // forge non construite
        }
        state.updatedAt = Date.now();
        // On garde l'état de ce village pour l'aperçu général
        state.data[snap.id] = {
          name: snap.name, updatedAt: state.updatedAt,
          buildQueue: state.buildQueue.slice(), train: Object.assign({}, state.train),
        };
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

    // Aperçu : analyse les AUTRES villages, un par un (main + caserne + écurie
    // + atelier : 3 ou 4 requêtes par village, espacées). Lancée seulement par
    // un clic sur "Analyser tous les villages".
    const scanVillages = async () => {
      if (state.scanning) return;
      if (!state.villages.length) { log('Liste des villages indisponible : aperçu impossible.'); return; }
      const gd0 = getGD();
      if (!gd0) { log('Page du jeu illisible.'); return; }
      const cur = parseInt(gd0.village.id, 10);
      const units = gd0.units || [];
      const builds = Config.scanGarage ? Config.trainBuildings : Config.trainBuildings.filter((b) => b !== 'garage');

      state.scanning = true; state.stop = false; state.scanDone = 0;
      renderAll();
      try {
        for (const v of state.villages) {
          if (state.stop) { log('Analyse interrompue.'); break; }
          if (v.id === cur && state.data[cur]) { state.scanDone++; continue; } // village affiché : déjà à jour
          const d = { name: v.label, updatedAt: 0, buildQueue: [], train: {} };
          d.buildQueue = parseBuildQueue(await fetchDoc('main', v.id));
          for (const b of builds) {
            await sleep(300);
            d.train[b] = parseTrainState(await fetchDoc(b, v.id), b, units);
          }
          d.updatedAt = Date.now();
          state.data[v.id] = d;
          state.scanDone++;
          renderAll();
          await sleep(300);
        }
        log('Analyse terminée (' + state.scanDone + ' / ' + state.villages.length + ' villages).');
      } catch (e) {
        log('Erreur pendant l\'analyse : ' + e.message);
      }
      state.scanning = false;
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

    // Statut détaillé du village affiché : constructions + chaque file militaire
    const renderStatus = () => {
      const loaded = state.updatedAt > 0;
      const idle = loaded ? idleOf({ buildQueue: state.buildQueue, train: state.train }) : [];
      const banner = !loaded ? ''
        : idle.length ? '<div class="warn">⚠ À relancer : ' + idle.map(esc).join(', ') + '</div>'
        : '<div>✓ Tout tourne.</div>';

      const row = (icon, label, lines) =>
        '<tr><td style="white-space:nowrap">' + icon + ' <b>' + esc(label) + '</b></td><td>' + lines + '</td></tr>';

      const bq = state.buildQueue;
      const constr = row(!loaded ? '·' : bq.length ? '🟢' : '🔴', 'Construction',
        !loaded ? '…' : bq.length
          ? bq.map((q) => esc(bLabel(q.name)) + (q.time ? ' <small>(' + esc(q.time) + ')</small>' : '')).join('<br>')
          : 'aucune construction');

      const train = Config.trainBuildings.map((b) => {
        const q = state.train[b];
        const optional = Config.required.indexOf(b) === -1;
        const icon = q === undefined ? '·' : q === null ? '—' : q.length ? '🟢' : optional ? '⚪' : '🔴';
        const lines = q === undefined ? '…' : q === null ? 'non construit(e)' : q.length
          ? q.map((x) => x.count + ' ' + esc(x.unit ? uLabel(x.unit) : '?') + (x.time ? ' <small>(' + esc(x.time) + ')</small>' : '')).join('<br>')
          : 'libre';
        return row(icon, bLabel(b), lines);
      }).join('');

      return '<div class="box"><b>En cours dans ce village</b>' + banner +
        '<table>' + constr + train + '</table>' +
        '<div style="font-size:11px">' + (state.updatedAt ? 'mis à jour à ' + new Date(state.updatedAt).toLocaleTimeString() : 'mise à jour en cours…') + '</div></div>';
    };

    const renderBuildings = () => {
      const s = state.snap;
      if (!s) return '';
      const eff = effectiveLevels(s.levels, state.buildQueue);
      const props = planBuildings(s, eff, state.buildInfo, 5);
      const first = props[0];
      const rows = Object.keys(s.levels).map((b) => {
        const q = eff[b] - s.levels[b];
        return '<tr class="' + (first && first.building === b ? 'cur' : '') + '"><td>' + esc(bLabel(b)) + '</td><td>' +
          s.levels[b] + (q ? ' (+' + q + ')' : '') + '</td></tr>';
      }).join('');

      const unreadable = state.updatedAt && Object.keys(state.buildInfo).length === 0
        ? '<div class="warn">Coûts illisibles sur la page du bâtiment principal : seules les urgences peuvent être proposées.</div>'
        : '';

      let proposal;
      if (!first) {
        proposal = 'Rien à proposer (objectifs atteints).';
      } else {
        const known = Object.keys(state.buildable).length > 0;
        const ok = state.buildable[first.building + ':' + first.to];
        const availability = !known ? '' : ok
          ? '<div>✓ constructible maintenant</div>'
          : '<div class="warn">✗ pas constructible maintenant (ressources, file pleine ou prérequis)</div>';
        const i = state.buildInfo[first.building];
        const costLine = i && i.total !== null
          ? '<div>Coût : bois ' + fmt(i.wood) + ' · argile ' + fmt(i.stone) + ' · fer ' + fmt(i.iron) +
            (i.time !== null ? ' · durée ' + fmtTime(i.time) : '') + '</div>'
          : '';
        // Si la première proposition n'est pas constructible maintenant, on
        // signale la première des suivantes qui l'est.
        const alt = known && !ok ? props.slice(1).find((p) => state.buildable[p.building + ':' + p.to]) : null;
        const altBlock = alt
          ? `<div style="margin-top:6px">Constructible à la place : <b>${esc(bLabel(alt.building))}</b> niveau ${alt.from} → ${alt.to}
             <div style="margin-top:4px"><button data-action="build" data-building="${esc(alt.building)}" data-level="${alt.to}">Construire</button></div></div>`
          : '';
        const next = props.slice(1, 4).map((p) => '• ' + esc(bLabel(p.building)) + ' → ' + p.to).join('<br>');
        proposal = `Proposition : <b>${esc(bLabel(first.building))}</b> niveau ${first.from} → ${first.to}
          <div>${esc(first.reason)}</div>${costLine}${availability}
          <div style="margin-top:4px"><button data-action="build" data-building="${esc(first.building)}" data-level="${first.to}">Construire</button></div>
          ${altBlock}
          ${next ? '<div style="margin-top:4px;font-size:11px">Ensuite :<br>' + next + '</div>' : ''}`;
      }
      return `<div class="box">${proposal}${unreadable}</div>
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

    const renderSmith = () => {
      const s = state.snap;
      if (!s) return '';
      if (state.smith === null) return '<div class="box">Forge non construite.</div>';
      if (state.smith === undefined) return '<div class="box">Lecture de la forge…</div>';
      const d = derive();
      const plan = planSmith(d.analysis, d.totals, state.smith);
      const role = '<div class="box">Village : <b>' + roleNames[d.analysis.role] + '</b></div>';
      if (plan.message) return role + '<div class="box">' + esc(plan.message) + '</div>';

      const rows = plan.candidates.map((t) =>
        '<tr class="' + (t === plan.first ? 'cur' : '') + '"><td>' + esc(uLabel(t.unit)) + '</td><td>' +
        (t.active ? 'améliorable' : 'pas maintenant') + '</td></tr>').join('');
      const f = plan.first;
      const proposal = 'Proposition : améliorer <b>' + esc(uLabel(f.unit)) + '</b>' +
        (f.active ? '<div>✓ possible maintenant</div>' : '<div class="warn">✗ pas possible maintenant (ressources ou recherche en cours)</div>') +
        '<div style="margin-top:4px"><button data-action="research" data-unit="' + esc(f.unit) + '">Améliorer</button></div>';
      return role + '<div class="box">' + proposal + '</div><h4>Troupes du rôle</h4><table>' + rows + '</table>';
    };

    // Aperçu de tous les villages : constructions, caserne, écurie, atelier
    const renderVillages = () => {
      const s = state.snap;
      const list = state.villages.length ? state.villages : (s ? [{ id: s.id, label: s.name }] : []);
      const optionalIcon = (b) => (Config.required.indexOf(b) === -1 ? '⚪' : '🔴');
      const cell = (q, b) => {
        if (q === undefined) return '·'; // pas encore analysé
        if (q === null) return '—';      // non construit ou illisible
        if (!q.length) return optionalIcon(b);
        return '🟢 ' + q.reduce((a, x) => a + x.count, 0);
      };

      let idleVillages = 0;
      let known = 0;
      const rows = list.map((v) => {
        const d = state.data[v.id];
        let idle = [];
        if (d) { known++; idle = idleOf(d); if (idle.length) idleVillages++; }
        const bq = d && d.buildQueue;
        const constr = !d ? '·' : bq.length ? '🟢 ' + bq.length : '🔴';
        const trainCells = Config.trainBuildings.map((b) =>
          '<td title="' + esc(d && d.train[b] ? queueText(d.train[b]) : '') + '">' + (d ? cell(d.train[b], b) : '·') + '</td>').join('');
        const age = d && d.updatedAt ? Math.round((Date.now() - d.updatedAt) / 60000) + ' min' : '';
        const isCur = s && v.id === s.id;
        return '<tr class="' + (isCur ? 'cur ' : '') + (idle.length ? 'idle' : '') + '">' +
          '<td>' + esc(v.label) + '</td>' +
          '<td title="' + esc(bq ? bq.map((q) => bLabel(q.name)).join(', ') : '') + '">' + constr + '</td>' +
          trainCells + '<td>' + age + '</td>' +
          '<td>' + (isCur ? '' : '<button data-action="goVillage" data-id="' + v.id + '">Aller</button>') + '</td></tr>';
      }).join('');

      const head = '<tr><td><b>Village</b></td><td><b>Constr.</b></td>' +
        Config.trainBuildings.map((b) => '<td><b>' + esc(bLabel(b).slice(0, 7)) + '</b></td>').join('') +
        '<td><b>Âge</b></td><td></td></tr>';

      const scanBtn = state.scanning
        ? '<button data-action="stopScan">Arrêter</button> Analyse… ' + state.scanDone + ' / ' + state.villages.length
        : '<button data-action="scan">Analyser tous les villages</button>';
      const summary = known
        ? '<div>' + (idleVillages ? '<span class="warn">⚠ ' + idleVillages + ' village(s) à relancer</span>' : '✓ Tout tourne sur les ' + known + ' village(s) analysés') + '</div>'
        : '<div>Pas encore d\'analyse : clique sur « Analyser tous les villages ».</div>';

      return '<div class="box">' + scanBtn + ' <button data-action="nextIdle">Prochain à relancer ▶</button>' + summary +
        '<div style="font-size:11px">🟢 en cours · 🔴 à relancer · ⚪ libre (optionnel) · — non construit ou illisible · · pas analysé.<br>' +
        "L'analyse fait 3 à 4 requêtes par village, une seule fois par clic.</div></div>" +
        '<table>' + head + rows + '</table>';
    };

    const renderAll = () => {
      const tab = (mode, label) => '<button data-action="mode" data-mode="' + mode + '" class="' + (state.mode === mode ? 'active' : '') + '">' + label + '</button>';
      const pending = state.pending ? '<div class="box">⏳ Action en attente de la prochaine page du jeu…</div>' : '';
      const content = state.mode === 'troops' ? renderTroops()
        : state.mode === 'smith' ? renderSmith()
        : state.mode === 'villages' ? renderVillages()
        : renderBuildings();
      $('app').innerHTML = renderHeader() + renderStatus() + pending +
        '<div style="margin-top:8px"><b>Que veux-tu gérer ?</b><br>' +
        tab('buildings', 'Bâtiments') + ' ' + tab('troops', 'Troupes') + ' ' + tab('smith', 'Forge') + ' ' + tab('villages', 'Aperçu') +
        ' <button data-action="next" title="Bâtiments → Troupes → Forge → village suivant">Suivant ▶</button></div>' +
        content;
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
        // Maximum recrutable avec les ressources actuelles : le nombre entre
        // parenthèses du lien "(max)" à côté du champ (#<unité>_0_a)
        // À VÉRIFIER avec l'inspecteur si le plafond n'est pas appliqué.
        const maxLink = doc.getElementById(p.unit + '_0_a') || doc.querySelector('a[id^="' + p.unit + '_"][id$="_a"]');
        const max = maxLink ? digits(maxLink.textContent) : null;
        let qty = p.qty;
        if (max !== null && qty > max) {
          log('Quantité proposée (' + qty + ') au-dessus du maximum possible : ' + max + ' ' + uLabel(p.unit) + '.');
          qty = max;
        }
        if (max === 0) log('Ressources insuffisantes pour recruter des ' + uLabel(p.unit) + ' maintenant.');
        input.value = qty > 0 ? String(qty) : '';
        input.dispatchEvent(new w.Event('input', { bubbles: true }));
        input.dispatchEvent(new w.Event('change', { bubbles: true }));
        input.focus();
        log(qty > 0 ? 'Quantité saisie : ' + qty + ' ' + uLabel(p.unit) + '. Clique sur Recruter dans le jeu.'
                    : 'Page de recrutement ouverte : choisis la quantité de ' + uLabel(p.unit) + '.');
      } else if (p.type === 'research') {
        if (!onVillage || gd.screen !== 'smith') { log('Amélioration annulée : page inattendue.'); return; }
        const re = new RegExp('[?&]id=' + p.unit + '(&|$)');
        const link = Array.from(w.document.querySelectorAll('a[href*="action=research"]')).find((a) =>
          re.test(a.getAttribute('href') || '') && !a.classList.contains('inactive') && a.getClientRects().length > 0);
        if (!link) { log("Impossible d'améliorer " + uLabel(p.unit) + ' (ressources insuffisantes ou recherche en cours).'); return; }
        link.click();
        log('Amélioration lancée : ' + uLabel(p.unit) + '.');
        setTimeout(refresh, 2500);
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

    const startResearch = (unit) => {
      const s = state.snap;
      if (!s) return;
      state.pending = { type: 'research', village: s.id, unit: unit };
      const gd = getGD();
      if (gd && gd.screen === 'smith' && parseInt(gd.village.id, 10) === s.id) {
        execPending(); // déjà à la forge : on clique tout de suite
      } else {
        log('Ouverture de la forge…');
        navigate('smith', s.id);
        renderAll();
      }
    };

    // Aller au prochain village (après l'actuel) qui a quelque chose à relancer,
    // d'après les dernières données connues
    const nextIdleVillage = () => {
      const gd = getGD();
      if (!gd || !state.villages.length) { log('Liste des villages indisponible.'); return; }
      const cur = state.villages.findIndex((v) => v.id === parseInt(gd.village.id, 10));
      for (let k = 1; k <= state.villages.length; k++) {
        const v = state.villages[(cur + k) % state.villages.length];
        const d = state.data[v.id];
        const idle = d ? idleOf(d) : [];
        if (idle.length && v.id !== parseInt(gd.village.id, 10)) {
          log(v.label + ' : à relancer → ' + idle.join(', '));
          state.mode = 'buildings';
          switchVillage(v.id);
          return;
        }
      }
      log("Aucun autre village à relancer (d'après les dernières données).");
    };

    // Bouton "Suivant" : bâtiments -> troupes -> forge -> village suivant (bâtiments)
    const nextStep = () => {
      if (state.mode === 'buildings') { state.mode = 'troops'; renderAll(); }
      else if (state.mode === 'troops') { state.mode = 'smith'; renderAll(); }
      else if (state.mode === 'smith') { state.mode = 'buildings'; renderAll(); stepVillage(1); }
      else { state.mode = 'buildings'; renderAll(); }
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
      else if (a === 'research') startResearch(t.getAttribute('data-unit'));
      else if (a === 'next') nextStep();
      else if (a === 'scan') scanVillages();
      else if (a === 'stopScan') { state.stop = true; }
      else if (a === 'goVillage') { state.mode = 'buildings'; switchVillage(parseInt(t.getAttribute('data-id'), 10)); }
      else if (a === 'nextIdle') nextIdleVillage();
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
    window.__bh = { state: state, idleOf: idleOf, planSmith: planSmith, planBuildings: planBuildings, chooseRecruit: chooseRecruit, analyseTroops: analyseTroops, computeRatio: computeRatio, parse: { parseBuildQueue, parseTrainQueue, parseVillageList, parseTroops } };
    tick();
  }

  /* =================================================================
   * 3. LANCEMENT : ouvre la fenêtre et y installe le code
   * ================================================================= */
  // Le nom 'bhPanel' fait que relancer le script retrouve la même fenêtre
  const win = window.open('', 'bhPanel', 'width=480,height=820');
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
      tr.idle td { background: #f8d7d0; }
      table td { font-size: 11px; }
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