/*
 * BuildHelper : script de base pour Guerres Tribales
 * --------------------------------------------------
 * But : regarder les niveaux de tes camps / carrière / mine, choisir
 *       le prochain bâtiment à monter, et te le proposer.
 *       C'est TOI qui valides par un clic (semi-automatique).
 *
 * Utilisation : colle-le dans la console du navigateur (F12) sur la
 * page "Bâtiment principal" de ton village (screen=main).
 *
 * Structure (même idée que FarmGod) :
 *   1. CONFIG   : les réglages que tu peux modifier
 *   2. DATA     : lire les informations dans le jeu
 *   3. PLANNER  : décider quoi construire
 *   4. UI       : afficher / réagir au clic
 *   5. MAIN     : lancer le tout dans le bon ordre
 */

// On met tout dans un objet pour ne pas polluer la page du jeu
window.BuildHelper = {};

/* ===================================================================
 * 1. CONFIG : tes réglages
 * =================================================================== */
window.BuildHelper.Config = {
  // Noms internes des bâtiments dans le jeu :
  //   wood = camp de bois, stone = carrière d'argile, iron = mine de fer
  // L'ordre = la priorité en cas d'égalité de niveau.
  buildings: ['wood', 'stone', 'iron'],

  // Niveau maximum que tu veux atteindre pour chaque bâtiment.
  // Le script s'arrête de proposer un bâtiment quand il atteint ce niveau.
  targetLevels: { wood: 20, stone: 20, iron: 20 },

  // Noms affichés dans les messages (juste pour que ce soit lisible)
  labels: { wood: 'Camp de bois', stone: 'Carrière', iron: 'Mine de fer' },
};

/* ===================================================================
 * 2. DATA : lire les informations du jeu
 * =================================================================== */
window.BuildHelper.Data = (function () {
  // game_data est un objet global fourni par le jeu.
  // game_data.village.buildings contient les niveaux, par exemple
  //   { main: "10", wood: "15", stone: "14", iron: "13", ... }
  // Les valeurs sont des textes, donc on les convertit en nombres.
  const getLevels = function (buildingNames) {
    const levels = {};
    buildingNames.forEach((name) => {
      levels[name] = parseInt(game_data.village.buildings[name], 10) || 0;
    });
    return levels;
  };

  // Cherche le bouton "Construire" d'un bâtiment dans la page.
  // Le jeu affiche un lien comme celui-ci (vérifié avec l'inspecteur) :
  //   <a class="btn btn-build" id="main_buildlink_stable_11"
  //      data-building="stable" data-level-next="11">Niveau 11</a>
  // On cherche donc par :
  //   - data-building   = le nom du bâtiment (ex. 'wood')
  //   - data-level-next = le niveau que ce bouton va construire
  // Le bouton est absent ou caché si on ne peut pas construire
  // (ressources insuffisantes, file pleine...).
  const getBuildButton = function (name, levelNext) {
    const $btn = $(
      'a.btn-build[data-building="' + name + '"][data-level-next="' + levelNext + '"]'
    ).filter(':visible').first();
    return $btn.length > 0 ? $btn : null;
  };

  return { getLevels, getBuildButton };
})();

/* ===================================================================
 * 3. PLANNER : décider quoi construire
 * =================================================================== */
window.BuildHelper.Planner = (function (Config) {
  // Règle simple : on monte le bâtiment qui a le niveau le PLUS BAS
  // parmi ceux qui n'ont pas encore atteint leur objectif.
  // Ça garde les trois ressources équilibrées.
  // Renvoie le nom du bâtiment (ex. 'wood') ou null s'il n'y a rien à faire.
  const chooseNext = function (levels) {
    let best = null;

    Config.buildings.forEach((name) => {
      // On ignore les bâtiments déjà au niveau voulu
      if (levels[name] >= Config.targetLevels[name]) return;

      // "<" strict : en cas d'égalité, le premier de la liste gagne
      if (best === null || levels[name] < levels[best]) {
        best = name;
      }
    });

    return best;
  };

  return { chooseNext };
})(window.BuildHelper.Config);

/* ===================================================================
 * 4. UI : afficher la proposition et réagir au clic
 * =================================================================== */
window.BuildHelper.UI = (function (Config) {
  // Affiche une boîte de dialogue avec la proposition.
  // onConfirm est une fonction qu'on appelle SEULEMENT si tu cliques.
  const showProposal = function (name, level, onConfirm) {
    const label = Config.labels[name];
    const html = `
      <h3>Builder</h3>
      <p>Prochain bâtiment proposé :<br>
         <b>${label}</b> : niveau ${level} → ${level + 1}</p>
      <input type="button" class="btn buildHelperConfirm" value="Construire">`;

    Dialog.show('BuildHelper', html);

    // .off('click') évite d'empiler plusieurs écouteurs si on relance le script
    $('.buildHelperConfirm').off('click').on('click', function () {
      Dialog.close();
      onConfirm();
    });
  };

  const info = (msg) => UI.InfoMessage(msg);
  const success = (msg) => UI.SuccessMessage(msg);
  const error = (msg) => UI.ErrorMessage(msg);

  return { showProposal, info, success, error };
})(window.BuildHelper.Config);

/* ===================================================================
 * 5. MAIN : l'ordre des opérations
 * =================================================================== */
window.BuildHelper.Main = (function (Config, Data, Planner, UI_) {
  const init = function () {
    // Étape 0 : on vérifie qu'on est sur la bonne page
    if (game_data.screen !== 'main') {
      // On redirige vers le bâtiment principal puis on s'arrête.
      // (Relance le script une fois la page chargée.)
      location.href = game_data.link_base_pure + 'main';
      return;
    }

    // Étape 1 : lire les niveaux actuels
    const levels = Data.getLevels(Config.buildings);
    console.log('Niveaux actuels :', levels);

    // Étape 2 : choisir le prochain bâtiment
    const next = Planner.chooseNext(levels);
    if (next === null) {
      UI_.info('Tous les objectifs sont atteints !');
      return;
    }

    // Étape 3 : proposer, et agir seulement après ton clic
    UI_.showProposal(next, levels[next], function () {
      // levels[next] + 1 = le niveau que le bouton doit construire
      const $btn = Data.getBuildButton(next, levels[next] + 1);

      if ($btn === null) {
        // Pas de bouton = pas assez de ressources, ou file de construction pleine
        UI_.error('Impossible de construire maintenant (ressources ou file pleine).');
        return;
      }

      // On "clique" nous-mêmes sur le bouton officiel du jeu.
      // On n'envoie donc rien de spécial : c'est comme si tu avais cliqué.
      $btn[0].click();
    });
  };

  return { init };
})(
  window.BuildHelper.Config,
  window.BuildHelper.Data,
  window.BuildHelper.Planner,
  window.BuildHelper.UI
);

// Lancement
window.BuildHelper.Main.init();