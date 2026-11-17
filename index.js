/*
 * BuildHelper : panneau d'aide pour Guerres Tribales
 * --------------------------------------------------
 * Affiche un panneau fixe à droite de l'écran (fermable avec la croix) avec :
 *   - en haut : le ratio  pop des soldats / points du village
 *   - la liste de TOUS les bâtiments du monde et leur niveau
 *   - la liste des troupes présentes dans le village (+ rôle Off / Def)
 *   - un choix : gérer les bâtiments OU gérer les troupes
 *       Bâtiments -> propose le prochain bâtiment à monter (tu valides par un clic)
 *       Troupes   -> propose quoi recruter (tu valides par un clic)
 *
 * Rien n'est envoyé sans ton clic.
 * Attention : le jeu recharge la page à chaque action, ce qui efface le
 * panneau. Il suffit de relancer le script (barre rapide).
 *
 * Structure :
 *   1. CONFIG  : tes réglages et les noms affichés
 *   2. DATA    : lire les informations dans le jeu
 *   3. PLANNER : décider quoi construire / recruter
 *   4. PANEL   : dessiner le panneau
 *   5. MAIN    : relier le tout
 */

// On met tout dans un objet pour ne pas polluer la page du jeu
window.BuildHelper = {};

/* ===================================================================
 * 1. CONFIG : tes réglages
 * =================================================================== */
window.BuildHelper.Config = {
  // --- Bâtiments ---------------------------------------------------
  // Bâtiments que le script peut te proposer de monter.
  // L'ordre = la priorité en cas d'égalité de niveau.
  buildings: ['wood', 'stone', 'iron'],

  // Niveau à atteindre pour chacun (au-delà, plus de proposition)
  targetLevels: { wood: 20, stone: 20, iron: 20 },

  // --- Troupes -----------------------------------------------------
  // Unités considérées comme offensives / défensives (pour le rôle du village)
  offUnits: ['axe', 'light', 'marcher', 'ram', 'catapult'],
  defUnits: ['spear', 'sword', 'archer', 'heavy'],

  // Un village est "Off" si au moins 80 % de sa population militaire
  // (off + def) est offensive, "Def" si au moins 80 % est défensive.
  // Entre les deux : "Mixte".
  roleShare: 0.8,

  // Rôle utilisé pour la proposition quand le village n'a aucune troupe
  defaultRole: 'def',

  // Paires d'unités à équilibrer pour chaque rôle.
  // Le premier de la paire est l'unité par défaut (si aucune n'existe encore).
  balance: { off: ['axe', 'light'], def: ['spear', 'sword'] },

  // L'équilibrage n'est proposé que si l'écart entre les deux unités
  // dépasse 10 % de leur population totale.
  balanceTolerance: 0.1,

  // --- Ratio pop / points ------------------------------------------
  // Unités ignorées dans le calcul de la pop des troupes
  ratioIgnore: ['spy'],

  // En dessous de cette valeur (pop des soldats / points du village), on
  // considère qu'il y a trop peu de soldats et on propose d'en recruter.
  // 0.7 est une valeur de départ : ajuste-la selon ton expérience.
  minPopPerPoint: 0.7,

  // --- Noms affichés (si un nom manque, le nom interne est affiché) -
  buildingLabels: {
    main: 'Quartier général', barracks: 'Caserne', stable: 'Écurie',
    garage: 'Atelier', church: 'Église', church_f: 'Première église',
    watchtower: 'Tour de guet', snob: 'Académie', smith: 'Forge',
    place: 'Place de ralliement', statue: 'Statue', market: 'Marché',
    wood: 'Camp de bois', stone: 'Carrière d\'argile', iron: 'Mine de fer',
    farm: 'Ferme', storage: 'Entrepôt', hide: 'Cachette', wall: 'Muraille',
  },
  unitLabels: {
    spear: 'Lancier', sword: 'Épéiste', axe: 'Hache', archer: 'Archer',
    spy: 'Éclaireur', light: 'Cavalerie légère', marcher: 'Archer monté',
    heavy: 'Cavalerie lourde', ram: 'Bélier', catapult: 'Catapulte',
    knight: 'Paladin', snob: 'Noble',
  },

  // Population (place dans la ferme) de chaque unité : sert à comparer
  // les unités entre elles et à calculer le ratio.
  unitPop: {
    spear: 1, sword: 1, axe: 1, archer: 1, spy: 2, light: 4,
    marcher: 5, heavy: 6, ram: 5, catapult: 8, knight: 10, snob: 100,
  },

  // Bâtiment où l'on recrute chaque unité (pour le bouton "Aller recruter")
  unitBuilding: {
    spear: 'barracks', sword: 'barracks', axe: 'barracks', archer: 'barracks',
    spy: 'stable', light: 'stable', marcher: 'stable', heavy: 'stable',
    ram: 'garage', catapult: 'garage',
  },
};

/* ===================================================================
 * 2. DATA : lire les informations du jeu
 * =================================================================== */
window.BuildHelper.Data = (function () {
  // game_data.village.buildings contient TOUS les bâtiments du monde, par
  // exemple { main: "10", wood: "15", ... }. Un bâtiment pas encore construit
  // a le niveau "0". Les valeurs sont du texte : on les convertit en nombres.
  const getAllLevels = function () {
    const levels = {};
    Object.keys(game_data.village.buildings).forEach((name) => {
      levels[name] = parseInt(game_data.village.buildings[name], 10) || 0;
    });
    return levels;
  };

  // Points du village. Le jeu les écrit comme du texte avec un séparateur
  // de milliers (ex. "8.164"), donc on garde uniquement les chiffres.
  // À VÉRIFIER dans la console : tape  game_data.village.points
  // Renvoie 0 si la valeur est introuvable.
  const getPoints = function () {
    const raw = game_data.village.points;
    return parseInt(String(raw).replace(/\D/g, ''), 10) || 0;
  };

  // Cherche le bouton "Construire" d'un bâtiment dans la page.
  // Le jeu affiche un lien comme celui-ci (vérifié avec l'inspecteur) :
  //   <a class="btn btn-build" id="main_buildlink_stable_11"
  //      data-building="stable" data-level-next="11">Niveau 11</a>
  // On le trouve avec data-building (le bâtiment) et data-level-next
  // (le niveau qu'il va construire). Il n'existe que sur la page du
  // bâtiment principal, et il est caché si on ne peut pas construire
  // (ressources insuffisantes, file pleine...).
  const getBuildButton = function (name, levelNext) {
    const $btn = $(
      'a.btn-build[data-building="' + name + '"][data-level-next="' + levelNext + '"]'
    ).filter(':visible').first();
    return $btn.length > 0 ? $btn : null;
  };

  // Lit les troupes présentes dans le village en chargeant la page
  // "Place de ralliement". Dans le formulaire d'envoi de troupes, chaque
  // unité a un champ #unit_input_<unité> dont l'attribut data-all-count
  // contient le nombre disponible.
  // À VÉRIFIER avec l'inspecteur (F12) si la liste reste vide.
  // Renvoie une promesse : on utilise .then(...) pour récupérer le résultat.
  const fetchTroops = function () {
    return $.get(game_data.link_base_pure + 'place').then((html) => {
      // On met la page reçue dans un <div> hors écran pour pouvoir la fouiller
      // ($.parseHTML retire les scripts, donc rien ne s'exécute).
      const $page = $('<div>').append($.parseHTML(html));
      const troops = {};

      game_data.units.forEach((unit) => {
        const count = parseInt($page.find('#unit_input_' + unit).attr('data-all-count'), 10);
        if (count > 0) troops[unit] = count;
      });

      return troops;
    });
  };

  return { getAllLevels, getPoints, getBuildButton, fetchTroops };
})();

/* ===================================================================
 * 3. PLANNER : décider quoi construire / recruter
 * =================================================================== */
window.BuildHelper.Planner = (function (Config) {
  const unitLabel = (u) => Config.unitLabels[u] || u;

  // BÂTIMENTS : on monte celui qui a le niveau le PLUS BAS parmi ceux
  // qui n'ont pas atteint leur objectif (garde les ressources équilibrées).
  // Renvoie le nom du bâtiment ou null s'il n'y a rien à faire.
  const chooseNextBuilding = function (levels) {
    let best = null;

    Config.buildings.forEach((name) => {
      if (levels[name] >= Config.targetLevels[name]) return;
      // "<" strict : en cas d'égalité, le premier de la liste gagne
      if (best === null || levels[name] < levels[best]) best = name;
    });

    return best;
  };

  // TROUPES, étape 1 : calculer la population offensive et défensive,
  // puis en déduire le rôle du village (voir roleShare dans la config).
  const analyseTroops = function (troops) {
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

    return { off, def, role };
  };

  // RATIO : pop utilisée par les soldats (sans éclaireurs) / points du village.
  // Plus le ratio est bas, moins le village a de soldats par rapport à sa taille.
  const computeRatio = function (troops, points) {
    let pop = 0;
    Object.keys(troops).forEach((u) => {
      if (Config.ratioIgnore.indexOf(u) === -1) pop += troops[u] * (Config.unitPop[u] || 0);
    });

    const ratio = points > 0 ? pop / points : null; // null = points inconnus
    return {
      points: points,
      pop: pop,
      ratio: ratio,
      low: ratio !== null && ratio < Config.minPopPerPoint,
    };
  };

  // TROUPES, étape 2 : proposer une unité à recruter. Deux raisons possibles :
  //   1. un déséquilibre dans la paire d'unités (lancier / épéiste ou
  //      hache / cavalerie légère), seulement si les DEUX existent déjà
  //   2. un ratio pop / points trop faible
  // Renvoie null s'il n'y a aucune raison de recruter.
  const chooseRecruit = function (troops, analysis, ratioInfo) {
    // Côté à renforcer : celui du rôle ; si Mixte, le côté le plus faible
    let side = analysis.role;
    if (side === 'vide') side = Config.defaultRole;
    else if (side === 'mixte') side = analysis.off < analysis.def ? 'off' : 'def';

    const pair = Config.balance[side];
    const present = pair.filter((u) => (troops[u] || 0) > 0);
    const reasons = [];
    let unit = pair[0]; // par défaut : le premier de la paire
    let quantity = null;

    if (analysis.role === 'vide') reasons.push('Aucune troupe dans le village.');

    if (present.length === 1) {
      // Une seule unité existe : on continue avec elle, pas d'équilibrage
      unit = present[0];
    } else if (present.length === 2) {
      // Les deux existent : on compare leur population (nombre × pop de l'unité)
      const popA = troops[pair[0]] * Config.unitPop[pair[0]];
      const popB = troops[pair[1]] * Config.unitPop[pair[1]];
      const diff = Math.abs(popA - popB);
      const weaker = popA <= popB ? pair[0] : pair[1];
      unit = weaker;

      // Nombre d'unités du plus faible pour combler l'écart
      const qty = Math.round(diff / Config.unitPop[weaker]);
      if (qty >= 1 && diff / (popA + popB) > Config.balanceTolerance) {
        quantity = qty;
        reasons.push(
          'Équilibrage ' + unitLabel(pair[0]) + ' / ' + unitLabel(pair[1]) +
          ' : il manque environ ' + qty + ' ' + unitLabel(weaker) + '.'
        );
      }
    }

    if (ratioInfo && ratioInfo.low) {
      reasons.push('Ratio pop / points faible : pas assez de soldats.');
    }

    if (reasons.length === 0) return null;
    return { side, unit, quantity, reasons };
  };

  return { chooseNextBuilding, analyseTroops, computeRatio, chooseRecruit };
})(window.BuildHelper.Config);

/* ===================================================================
 * 4. PANEL : dessiner le panneau à droite de l'écran
 * =================================================================== */
window.BuildHelper.Panel = (function (Config) {
  const ID = 'buildHelperPanel';
  const roleNames = { off: 'Off', def: 'Def', mixte: 'Mixte', vide: 'Aucune troupe' };

  const buildingLabel = (name) => Config.buildingLabels[name] || name;
  const unitLabel = (name) => Config.unitLabels[name] || name;
  const fmt = (n) => n.toLocaleString('fr-FR'); // 8164 -> "8 164"

  // Crée le panneau (et supprime l'ancien si on relance le script)
  const create = function () {
    remove();

    $('head').append(`<style id="${ID}Style">
      #${ID} { position: fixed; /* reste en place quand on fait défiler */
        top: 80px; right: 10px; width: 260px; max-height: 85vh; overflow-y: auto;
        z-index: 9999; background: #f4e4bc; border: 2px solid #7d510f;
        padding: 8px; font-size: 11px; }
      #${ID} .bh-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
      #${ID} .bh-section { margin-top: 8px; }
      #${ID} .bh-list { max-height: 140px; overflow-y: auto; }
      #${ID} table { width: 100%; }
      #${ID} .bh-current td { font-weight: bold; background: #e7d098; }
      #${ID} .bh-warn { color: #c00; font-weight: bold; }
    </style>`);

    $('body').append(`
      <div id="${ID}">
        <div class="bh-header">
          <b>BuildHelper</b>
          <a href="#" id="bhClose" title="Fermer">✕</a>
        </div>
        <div id="bhRatio">Pop soldats / points : chargement…</div>
        <div class="bh-section"><b>Bâtiments</b><div class="bh-list" id="bhBuildings"></div></div>
        <div class="bh-section"><b>Troupes</b><div class="bh-list" id="bhTroops">Chargement…</div></div>
        <div class="bh-section">
          <b>Que veux-tu gérer ?</b><br>
          <input type="button" class="btn" id="bhModeBuildings" value="Bâtiments">
          <input type="button" class="btn" id="bhModeTroops" value="Troupes">
        </div>
        <div class="bh-section" id="bhProposal"></div>
      </div>`);

    // La croix ferme le panneau
    $('#bhClose').on('click', function (e) {
      e.preventDefault();
      remove();
    });
  };

  const remove = function () {
    $('#' + ID).remove();
    $('#' + ID + 'Style').remove();
  };

  // Ratio en haut du panneau. info = null si les points sont introuvables.
  const renderRatio = function (info) {
    if (info === null) {
      $('#bhRatio').text('Pop soldats / points : indisponible');
      return;
    }
    const value = info.ratio.toFixed(2);
    const warn = info.low ? ' <span class="bh-warn">⚠ faible</span>' : '';
    $('#bhRatio').html(
      `Pop soldats / points : <b>${value}</b>${warn}<br>
       <small>${fmt(info.pop)} pop (sans éclaireurs) / ${fmt(info.points)} pts</small>`
    );
  };

  // Liste de tous les bâtiments du monde. Le bâtiment proposé est en gras.
  const renderBuildings = function (levels, highlight) {
    let rows = '';
    Object.keys(levels).forEach((name) => {
      rows += `<tr class="${name === highlight ? 'bh-current' : ''}">
                 <td>${buildingLabel(name)}</td><td>${levels[name]}</td></tr>`;
    });
    $('#bhBuildings').html(`<table class="vis">${rows}</table>`);
  };

  // Liste des troupes + rôle du village
  const renderTroops = function (troops, analysis) {
    let rows = '';
    Object.keys(troops).forEach((unit) => {
      rows += `<tr><td>${unitLabel(unit)}</td><td>${troops[unit]}</td></tr>`;
    });

    const table = rows ? `<table class="vis">${rows}</table>` : 'Aucune troupe dans le village.';
    $('#bhTroops').html(`${table}<br>Rôle du village : <b>${roleNames[analysis.role]}</b>`);
  };

  const renderTroopsError = function () {
    $('#bhTroops').text('Impossible de lire les troupes.');
    $('#bhRatio').text('Pop soldats / points : indisponible');
  };

  // Zone du bas : la proposition + éventuellement un bouton.
  // onClick n'est appelée QUE si tu cliques sur le bouton.
  const showProposal = function (html, buttonLabel, onClick) {
    const button = buttonLabel
      ? `<br><input type="button" class="btn" id="bhAction" value="${buttonLabel}">`
      : '';
    $('#bhProposal').html(html + button);

    // .off('click') évite d'empiler plusieurs écouteurs
    $('#bhAction').off('click').on('click', onClick);
  };

  const onModeBuildings = (fn) => $('#bhModeBuildings').off('click').on('click', fn);
  const onModeTroops = (fn) => $('#bhModeTroops').off('click').on('click', fn);

  const error = (msg) => UI.ErrorMessage(msg);

  return {
    create, renderRatio, renderBuildings, renderTroops, renderTroopsError,
    showProposal, onModeBuildings, onModeTroops, error,
    buildingLabel, unitLabel, roleNames,
  };
})(window.BuildHelper.Config);

/* ===================================================================
 * 5. MAIN : relier le tout
 * =================================================================== */
window.BuildHelper.Main = (function (Config, Data, Planner, Panel) {
  // Mémoire du script pendant que le panneau est ouvert
  const state = { levels: {}, troops: null, analysis: null, ratio: null };

  // --- Choix "Bâtiments" : même logique qu'avant -------------------
  const proposeBuilding = function () {
    const next = Planner.chooseNextBuilding(state.levels);
    Panel.renderBuildings(state.levels, next); // met le bâtiment proposé en gras

    if (next === null) {
      Panel.showProposal('Tous les objectifs sont atteints !');
      return;
    }

    const level = state.levels[next];
    const text = `Prochain bâtiment proposé :<br>
      <b>${Panel.buildingLabel(next)}</b> : niveau ${level} → ${level + 1}`;

    // Le bouton officiel "Construire" n'existe que sur la page du bâtiment
    // principal. Ailleurs, on propose d'y aller d'abord.
    if (game_data.screen !== 'main') {
      Panel.showProposal(text, 'Ouvrir le bâtiment principal', function () {
        location.href = game_data.link_base_pure + 'main';
      });
      return;
    }

    Panel.showProposal(text, 'Construire', function () {
      const $btn = Data.getBuildButton(next, level + 1);
      if ($btn === null) {
        // Pas de bouton = pas assez de ressources, ou file de construction pleine
        Panel.error('Impossible de construire maintenant (ressources ou file pleine).');
        return;
      }
      // On "clique" nous-mêmes sur le bouton officiel du jeu : c'est comme
      // si tu avais cliqué toi-même.
      $btn[0].click();
    });
  };

  // --- Choix "Troupes" : équilibrage + ratio -----------------------
  const proposeTroops = function () {
    if (state.troops === null) {
      Panel.showProposal('Les troupes sont en cours de chargement, réessaie dans un instant.');
      return;
    }

    const roleText = `Village : <b>${Panel.roleNames[state.analysis.role]}</b>`;
    const rec = Planner.chooseRecruit(state.troops, state.analysis, state.ratio);

    if (rec === null) {
      Panel.showProposal(roleText + '<br>Troupes équilibrées et ratio correct : rien à recruter pour le moment.');
      return;
    }

    const reasons = rec.reasons.map((r) => '• ' + r).join('<br>');
    const qty = rec.quantity ? ` (environ ${rec.quantity})` : '';
    const text = `${roleText}<br>${reasons}<br><br>
      Proposition : recruter <b>${Panel.unitLabel(rec.unit)}</b>${qty}`;

    // Le bouton t'emmène sur la page de recrutement du bon bâtiment
    // (caserne, écurie ou atelier) : tu choisis toi-même la quantité.
    Panel.showProposal(text, 'Aller recruter', function () {
      location.href = game_data.link_base_pure + Config.unitBuilding[rec.unit];
    });
  };

  const init = function () {
    // Étape 1 : dessiner le panneau
    Panel.create();

    // Étape 2 : afficher tous les bâtiments (lecture immédiate)
    state.levels = Data.getAllLevels();
    Panel.renderBuildings(state.levels, null);

    // Étape 3 : brancher les deux boutons du choix
    Panel.onModeBuildings(proposeBuilding);
    Panel.onModeTroops(proposeTroops);

    // Étape 4 : charger les troupes (demande au serveur, donc un peu plus lent),
    // puis calculer le rôle du village et le ratio pop / points
    Data.fetchTroops().then(
      function (troops) {
        state.troops = troops;
        state.analysis = Planner.analyseTroops(troops);
        Panel.renderTroops(troops, state.analysis);

        const points = Data.getPoints();
        state.ratio = points > 0 ? Planner.computeRatio(troops, points) : null;
        Panel.renderRatio(state.ratio);
      },
      function () {
        Panel.renderTroopsError();
      }
    );
  };

  return { init };
})(
  window.BuildHelper.Config,
  window.BuildHelper.Data,
  window.BuildHelper.Planner,
  window.BuildHelper.Panel
);

// Lancement
window.BuildHelper.Main.init();