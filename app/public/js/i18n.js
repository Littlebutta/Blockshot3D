// Interface languages (Settings → Language, or the 🌐 corner of the title screen).
// Menus are translated by matching their English text, so adding a language is just a new column
// in DICT. Text set from code goes through t('English {n}', { n }). Card names and descriptions
// come from card.json files and stay as written.
export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português' };
const COLS = ['es', 'fr', 'de', 'pt'];

// English: [Español, Français, Deutsch, Português]
const DICT = {
  // title
  'Arena duels. Lose a round, pick an upgrade card. First to the target score wins.': ['Duelos en la arena. Pierde una ronda, elige una carta de mejora. Gana quien llegue primero a la meta.', 'Duels en arène. Perdez une manche, choisissez une carte d\'amélioration. Le premier au score cible gagne.', 'Arena-Duelle. Verliere eine Runde, wähle eine Upgrade-Karte. Wer zuerst das Ziel erreicht, gewinnt.', 'Duelos na arena. Perca uma rodada, escolha uma carta de melhoria. Quem chegar primeiro à meta vence.'],
  'Play': ['Jugar', 'Jouer', 'Spielen', 'Jogar'],
  'Practice range': ['Campo de práctica', 'Champ d\'entraînement', 'Übungsplatz', 'Campo de treino'],
  'Multiplayer': ['Multijugador', 'Multijoueur', 'Mehrspieler', 'Multijogador'],
  'Customize': ['Personalizar', 'Personnaliser', 'Anpassen', 'Personalizar'],
  'Card directory': ['Catálogo de cartas', 'Répertoire des cartes', 'Kartenverzeichnis', 'Catálogo de cartas'],
  'Art gallery': ['Galería de arte', 'Galerie d\'art', 'Kunstgalerie', 'Galeria de arte'],
  'The Wiki': ['La Wiki', 'Le Wiki', 'Das Wiki', 'A Wiki'],
  'Settings': ['Ajustes', 'Paramètres', 'Einstellungen', 'Configurações'],
  'Move': ['Moverse', 'Se déplacer', 'Bewegen', 'Mover'],
  'Jump': ['Saltar', 'Sauter', 'Springen', 'Pular'],
  'Aim': ['Apuntar', 'Viser', 'Zielen', 'Mirar'],
  'Shoot (hold)': ['Disparar (mantener)', 'Tirer (maintenir)', 'Schießen (halten)', 'Atirar (segurar)'],
  'Block — stops bullets': ['Bloquear — detiene balas', 'Bloquer — arrête les balles', 'Blocken — stoppt Kugeln', 'Bloquear — para balas'],
  'Reload': ['Recargar', 'Recharger', 'Nachladen', 'Recarregar'],
  'Switch first / third person': ['Cambiar primera / tercera persona', 'Basculer 1re / 3e personne', 'Ego- / Third-Person wechseln', 'Alternar primeira / terceira pessoa'],
  'First person: free the cursor to check the scoreboard': ['Primera persona: libera el cursor para ver el marcador', 'Vue subjective : libère le curseur pour voir le tableau', 'Ego-Sicht: Mauszeiger freigeben, um die Tabelle zu sehen', 'Primeira pessoa: libera o cursor para ver o placar'],
  'Pause / settings': ['Pausa / ajustes', 'Pause / paramètres', 'Pause / Einstellungen', 'Pausa / configurações'],
  // multiplayer
  'Your name': ['Tu nombre', 'Votre nom', 'Dein Name', 'Seu nome'],
  'Host for Steam friends': ['Crear partida para amigos de Steam', 'Héberger pour les amis Steam', 'Für Steam-Freunde hosten', 'Hospedar para amigos da Steam'],
  "Friends' games with a free spot": ['Partidas de amigos con hueco libre', 'Parties d\'amis avec une place libre', 'Spiele von Freunden mit freiem Platz', 'Partidas de amigos com vaga livre'],
  'Refresh': ['Actualizar', 'Actualiser', 'Aktualisieren', 'Atualizar'],
  'Local network / testing': ['Red local / pruebas', 'Réseau local / tests', 'Lokales Netzwerk / Tests', 'Rede local / testes'],
  'Host a game': ['Crear partida', 'Héberger une partie', 'Spiel hosten', 'Hospedar partida'],
  'Open a test window': ['Abrir ventana de prueba', 'Ouvrir une fenêtre de test', 'Testfenster öffnen', 'Abrir janela de teste'],
  'Join': ['Unirse', 'Rejoindre', 'Beitreten', 'Entrar'],
  'Open rooms on this server': ['Salas abiertas en este servidor', 'Salons ouverts sur ce serveur', 'Offene Räume auf diesem Server', 'Salas abertas neste servidor'],
  'Back': ['Volver', 'Retour', 'Zurück', 'Voltar'],
  'Room code': ['Código de sala', 'Code du salon', 'Raumcode', 'Código da sala'],
  // lobby
  'Lobby': ['Sala', 'Salon', 'Lobby', 'Sala'],
  'Players': ['Jugadores', 'Joueurs', 'Spieler', 'Jogadores'],
  'Easy bot': ['Bot fácil', 'Bot facile', 'Leichter Bot', 'Bot fácil'],
  'Normal bot': ['Bot normal', 'Bot normal', 'Normaler Bot', 'Bot normal'],
  'Hard bot': ['Bot difícil', 'Bot difficile', 'Schwerer Bot', 'Bot difícil'],
  'Add bot': ['Añadir bot', 'Ajouter un bot', 'Bot hinzufügen', 'Adicionar bot'],
  'Mode': ['Modo', 'Mode', 'Modus', 'Modo'],
  'Free for all': ['Todos contra todos', 'Chacun pour soi', 'Jeder gegen jeden', 'Todos contra todos'],
  'Everyone for themselves': ['Cada uno por su cuenta', 'Chacun pour sa peau', 'Jeder für sich', 'Cada um por si'],
  'Team deathmatch': ['Combate por equipos', 'Match à mort en équipe', 'Team-Deathmatch', 'Mata-mata em equipe'],
  'Up to 4 teams': ['Hasta 4 equipos', 'Jusqu\'à 4 équipes', 'Bis zu 4 Teams', 'Até 4 equipes'],
  'Co-op waves': ['Oleadas cooperativas', 'Vagues en coop', 'Koop-Wellen', 'Ondas cooperativas'],
  'Survive the raiders together': ['Sobrevivid juntos a los asaltantes', 'Survivez ensemble aux pillards', 'Überlebt die Angreifer gemeinsam', 'Sobrevivam juntos aos saqueadores'],
  'Test builds on dummies': ['Prueba builds con muñecos', 'Testez vos builds sur des mannequins', 'Builds an Dummys testen', 'Teste builds em bonecos'],
  'Rounds to win': ['Rondas para ganar', 'Manches pour gagner', 'Runden zum Sieg', 'Rodadas para vencer'],
  'Waves to survive': ['Oleadas a sobrevivir', 'Vagues à survivre', 'Zu überlebende Wellen', 'Ondas para sobreviver'],
  'Co-op difficulty': ['Dificultad cooperativa', 'Difficulté coop', 'Koop-Schwierigkeit', 'Dificuldade cooperativa'],
  'Easy': ['Fácil', 'Facile', 'Leicht', 'Fácil'],
  'Hard': ['Difícil', 'Difficile', 'Schwer', 'Difícil'],
  'Nightmare': ['Pesadilla', 'Cauchemar', 'Albtraum', 'Pesadelo'],
  'The final wave brings a boss. Co-op never uses Lava Lake.': ['La última oleada trae un jefe. El cooperativo nunca usa el Lago de Lava.', 'La dernière vague amène un boss. La coop n\'utilise jamais le Lac de lave.', 'Die letzte Welle bringt einen Boss. Koop nutzt nie den Lavasee.', 'A última onda traz um chefe. O cooperativo nunca usa o Lago de Lava.'],
  'Final wave': ['Oleada final', 'Vague finale', 'Letzte Welle', 'Onda final'],
  'Reinforcements incoming': ['Llegan refuerzos', 'Renforts en approche', 'Verstärkung kommt', 'Reforços chegando'],
  'Wave budget': ['Presupuesto de oleada', 'Budget de vague', 'Wellenbudget', 'Orçamento da onda'],
  'reinforcements coming': ['vienen refuerzos', 'renforts à venir', 'Verstärkung folgt', 'reforços a caminho'],
  'The Warden opens portals!': ['¡El Guardián abre portales!', 'Le Gardien ouvre des portails !', 'Der Wächter öffnet Portale!', 'O Guardião abre portais!'],
  'Shockwave — jump over it!': ['Onda expansiva: ¡sáltala!', 'Onde de choc — sautez par-dessus !', 'Schockwelle — drüberspringen!', 'Onda de choque — pule por cima!'],
  'Get close or get away!': ['¡Acércate o aléjate!', 'Approchez ou éloignez-vous !', 'Ran oder weg!', 'Chegue perto ou se afaste!'],
  'The Warden grows furious!': ['¡El Guardián se enfurece!', 'Le Gardien devient furieux !', 'Der Wächter wird wütend!', 'O Guardião fica furioso!'],
  'The Warden is desperate!': ['¡El Guardián está desesperado!', 'Le Gardien est désespéré !', 'Der Wächter ist verzweifelt!', 'O Guardião está desesperado!'],
  'The Warden is enraged!': ['¡El Guardián está enloquecido!', 'Le Gardien enrage !', 'Der Wächter rast!', 'O Guardião está enfurecido!'],
  'The Warden falls!': ['¡El Guardián cae!', 'Le Gardien tombe !', 'Der Wächter fällt!', 'O Guardião cai!'],
  'Enraged': ['Enloquecido', 'Enragé', 'Rasend', 'Enfurecido'],
  'Wave difficulty': ['Dificultad de oleadas', 'Difficulté des vagues', 'Wellen-Schwierigkeit', 'Dificuldade das ondas'],
  'Relaxed': ['Relajada', 'Détendue', 'Entspannt', 'Tranquila'],
  'Normal': ['Normal', 'Normale', 'Normal', 'Normal'],
  'Brutal': ['Brutal', 'Brutale', 'Brutal', 'Brutal'],
  'Friendly fire (bullets can hurt teammates)': ['Fuego amigo (las balas dañan a compañeros)', 'Tir allié (les balles blessent les coéquipiers)', 'Eigenbeschuss (Kugeln treffen Teamkollegen)', 'Fogo amigo (balas ferem aliados)'],
  'Shuffle teams': ['Mezclar equipos', 'Mélanger les équipes', 'Teams mischen', 'Embaralhar equipes'],
  '⚡ Speed mode: two card picks per pick phase': ['⚡ Modo rápido: dos cartas por fase de elección', '⚡ Mode rapide : deux cartes par phase de choix', '⚡ Tempo-Modus: zwei Karten pro Auswahlphase', '⚡ Modo rápido: duas cartas por fase de escolha'],
  'Target dummies': ['Muñecos de práctica', 'Mannequins', 'Zielpuppen', 'Bonecos de treino'],
  'Dummies': ['Muñecos', 'Mannequins', 'Puppen', 'Bonecos'],
  'Stand still': ['Quietos', 'Immobiles', 'Stillstehen', 'Parados'],
  'Walk around': ['Caminan', 'Se promènent', 'Herumlaufen', 'Andando'],
  'Fight back': ['Contraatacan', 'Ripostent', 'Wehren sich', 'Revidam'],
  'Dummy health': ['Vida de muñecos', 'Vie des mannequins', 'Puppen-Leben', 'Vida dos bonecos'],
  "You can't die": ['No puedes morir', 'Vous ne pouvez pas mourir', 'Du kannst nicht sterben', 'Você não morre'],
  'Add and remove any card during play from the practice panel (P).': ['Añade y quita cartas durante la partida desde el panel de práctica (P).', 'Ajoutez et retirez des cartes en jeu depuis le panneau d\'entraînement (P).', 'Karten im Spiel über das Übungsmenü (P) hinzufügen und entfernen.', 'Adicione e remova cartas durante o jogo pelo painel de treino (P).'],
  'Cards': ['Cartas', 'Cartes', 'Karten', 'Cartas'],
  'Rerolls per match': ['Cambios por partida', 'Relances par partie', 'Neu-Würfe pro Match', 'Trocas por partida'],
  'Off': ['No', 'Non', 'Aus', 'Não'],
  'Card pick time': ['Tiempo para elegir', 'Temps de choix', 'Auswahlzeit', 'Tempo de escolha'],
  'No time limit': ['Sin límite', 'Sans limite', 'Kein Zeitlimit', 'Sem limite'],
  'Combo cards (matching pairs merge into something new)': ['Cartas combo (las parejas se fusionan)', 'Cartes combo (les paires fusionnent)', 'Kombokarten (passende Paare verschmelzen)', 'Cartas combo (pares se fundem)'],
  'Commander mode: you pick the cards, a bot fights for you (unlocks unit cards)': ['Modo comandante: tú eliges cartas, un bot lucha por ti', 'Mode commandant : vous choisissez, un bot combat pour vous', 'Kommandanten-Modus: du wählst Karten, ein Bot kämpft', 'Modo comandante: você escolhe, um bot luta por você'],
  'Cursed cards and weapon mods are always in the deck (both very rare).': ['Las cartas malditas y los mods de arma siempre están en el mazo (muy raros).', 'Les cartes maudites et mods d\'arme sont toujours dans le paquet (très rares).', 'Verfluchte Karten und Waffen-Mods sind immer im Deck (sehr selten).', 'Cartas amaldiçoadas e mods de arma estão sempre no baralho (muito raros).'],
  'Arena': ['Arena', 'Arène', 'Arena', 'Arena'],
  'Maps': ['Mapas', 'Cartes', 'Karten', 'Mapas'],
  'Mixed': ['Mixtos', 'Mélangées', 'Gemischt', 'Mistos'],
  'Random generated': ['Generados', 'Générées', 'Zufällig erzeugt', 'Gerados'],
  'Classic layouts': ['Clásicos', 'Classiques', 'Klassisch', 'Clássicos'],
  'Lava Lake only': ['Solo Lago de Lava', 'Lac de lave uniquement', 'Nur Lavasee', 'Só Lago de Lava'],
  'Map themes': ['Temas de mapa', 'Thèmes de carte', 'Kartenthemen', 'Temas de mapa'],
  'Standard': ['Estándar', 'Standard', 'Standard', 'Padrão'],
  'All': ['Todos', 'Tous', 'Alle', 'Todos'],
  'Map hazards (random rounds get a laser, saws or a rogue turret)': ['Peligros (láser, sierras o torreta en algunas rondas)', 'Dangers (laser, scies ou tourelle sur certaines manches)', 'Gefahren (Laser, Sägen oder Geschütz in manchen Runden)', 'Perigos (laser, serras ou torre em algumas rodadas)'],
  'Arena size grows with the number of players.': ['La arena crece con el número de jugadores.', 'L\'arène grandit avec le nombre de joueurs.', 'Die Arena wächst mit der Spielerzahl.', 'A arena cresce com o número de jogadores.'],
  'Invite Steam friends': ['Invitar amigos de Steam', 'Inviter des amis Steam', 'Steam-Freunde einladen', 'Convidar amigos da Steam'],
  'Start match': ['Empezar', 'Lancer la partie', 'Match starten', 'Começar'],
  'Leave': ['Salir', 'Quitter', 'Verlassen', 'Sair'],
  'Remove': ['Quitar', 'Retirer', 'Entfernen', 'Remover'],
  'Kick': ['Expulsar', 'Expulser', 'Rauswerfen', 'Expulsar'],
  'You': ['Tú', 'Vous', 'Du', 'Você'],
  'Bot': ['Bot', 'Bot', 'Bot', 'Bot'],
  'Host': ['Anfitrión', 'Hôte', 'Host', 'Anfitrião'],
  'Player': ['Jugador', 'Joueur', 'Spieler', 'Jogador'],
  // settings
  'Name': ['Nombre', 'Nom', 'Name', 'Nome'],
  'Language': ['Idioma', 'Langue', 'Sprache', 'Idioma'],
  'Camera': ['Cámara', 'Caméra', 'Kamera', 'Câmera'],
  'Third person (top-down)': ['Tercera persona (cenital)', '3e personne (vue de dessus)', 'Third-Person (von oben)', 'Terceira pessoa (de cima)'],
  'First person': ['Primera persona', 'Vue subjective', 'Ego-Perspektive', 'Primeira pessoa'],
  'Field of view': ['Campo de visión', 'Champ de vision', 'Sichtfeld', 'Campo de visão'],
  'Mouse sensitivity (first person)': ['Sensibilidad del ratón (1.ª persona)', 'Sensibilité de la souris (vue subjective)', 'Mausempfindlichkeit (Ego)', 'Sensibilidade do mouse (1ª pessoa)'],
  'Master volume': ['Volumen general', 'Volume général', 'Gesamtlautstärke', 'Volume geral'],
  'Music volume': ['Volumen de música', 'Volume de la musique', 'Musiklautstärke', 'Volume da música'],
  'Effects volume': ['Volumen de efectos', 'Volume des effets', 'Effektlautstärke', 'Volume dos efeitos'],
  'Particle effects': ['Partículas', 'Particules', 'Partikel', 'Partículas'],
  'High': ['Altas', 'Élevées', 'Hoch', 'Altas'],
  'Low': ['Bajas', 'Faibles', 'Niedrig', 'Baixas'],
  'Shadows': ['Sombras', 'Ombres', 'Schatten', 'Sombras'],
  'Screen shake': ['Temblor de pantalla', 'Tremblement d\'écran', 'Bildschirmwackeln', 'Tremor de tela'],
  'Grass and pebbles (applies next round)': ['Hierba y piedras (desde la próxima ronda)', 'Herbe et cailloux (à la prochaine manche)', 'Gras und Kiesel (ab nächster Runde)', 'Grama e pedrinhas (na próxima rodada)'],
  'Color-blind mode': ['Modo daltónico', 'Mode daltonien', 'Farbenblind-Modus', 'Modo daltônico'],
  'Protanopia (red-weak)': ['Protanopía (rojo)', 'Protanopie (rouge)', 'Protanopie (Rot)', 'Protanopia (vermelho)'],
  'Deuteranopia (green-weak)': ['Deuteranopía (verde)', 'Deutéranopie (vert)', 'Deuteranopie (Grün)', 'Deuteranopia (verde)'],
  'Tritanopia (blue-yellow)': ['Tritanopía (azul-amarillo)', 'Tritanopie (bleu-jaune)', 'Tritanopie (Blau-Gelb)', 'Tritanopia (azul-amarelo)'],
  'Card tips: point out cards that fit your build': ['Consejos: señala cartas que encajan con tu build', 'Conseils : signale les cartes adaptées à votre build', 'Kartentipps: zeigt Karten, die zu deinem Build passen', 'Dicas: indica cartas que combinam com sua build'],
  'AI slop filter ✨ (only changes what you see)': ['Filtro de bazofia IA ✨ (solo cambia lo que ves)', 'Filtre bouillie IA ✨ (ne change que votre écran)', 'KI-Schrott-Filter ✨ (ändert nur deine Ansicht)', 'Filtro de lixo de IA ✨ (só muda o que você vê)'],
  'Done': ['Listo', 'Terminé', 'Fertig', 'Pronto'],
  // customize
  'Accessories keep their own colors, so they look the same on any team.': ['Los accesorios mantienen sus colores en cualquier equipo.', 'Les accessoires gardent leurs couleurs dans toute équipe.', 'Accessoires behalten ihre Farben in jedem Team.', 'Os acessórios mantêm as cores em qualquer equipe.'],
  'Drag the preview to turn your character.': ['Arrastra la vista previa para girar al personaje.', 'Faites glisser l\'aperçu pour tourner le personnage.', 'Ziehe die Vorschau, um die Figur zu drehen.', 'Arraste a prévia para girar o personagem.'],
  'Randomize': ['Aleatorio', 'Aléatoire', 'Zufällig', 'Aleatório'],
  'Hat': ['Sombrero', 'Chapeau', 'Hut', 'Chapéu'], 'Face': ['Cara', 'Visage', 'Gesicht', 'Rosto'], 'Eyes': ['Ojos', 'Yeux', 'Augen', 'Olhos'], 'Neck': ['Cuello', 'Cou', 'Hals', 'Pescoço'],
  'Gun skin': ['Aspecto del arma', 'Skin d\'arme', 'Waffen-Skin', 'Skin da arma'],
  'None': ['Ninguno', 'Aucun', 'Keins', 'Nenhum'],
  // pick / pause / over
  'You lost the round': ['Perdiste la ronda', 'Vous avez perdu la manche', 'Runde verloren', 'Você perdeu a rodada'],
  'Pick one upgrade. Press 1, 2 or 3, or click a card.': ['Elige una mejora. Pulsa 1, 2 o 3, o haz clic en una carta.', 'Choisissez une amélioration. Appuyez sur 1, 2 ou 3, ou cliquez sur une carte.', 'Wähle ein Upgrade. Drücke 1, 2 oder 3 oder klicke eine Karte.', 'Escolha uma melhoria. Pressione 1, 2 ou 3, ou clique numa carta.'],
  'Reroll': ['Cambiar', 'Relancer', 'Neu würfeln', 'Trocar'],
  'Combo available!': ['¡Combo disponible!', 'Combo disponible !', 'Kombo verfügbar!', 'Combo disponível!'],
  'Combine': ['Combinar', 'Combiner', 'Kombinieren', 'Combinar'],
  'Keep separate': ['Mantener separadas', 'Garder séparées', 'Getrennt lassen', 'Manter separadas'],
  'Paused': ['En pausa', 'En pause', 'Pausiert', 'Pausado'],
  'Resume': ['Continuar', 'Reprendre', 'Weiter', 'Continuar'],
  'Leave match': ['Abandonar partida', 'Quitter la partie', 'Match verlassen', 'Sair da partida'],
  'Leave to lobby': ['Volver a la sala', 'Retour au salon', 'Zurück zur Lobby', 'Voltar ao lobby'],
  'Disconnect': ['Desconectar', 'Se déconnecter', 'Trennen', 'Desconectar'],
  'Leave range': ['Salir del campo', 'Quitter le stand', 'Schießstand verlassen', 'Sair do estande'],
  'Victory': ['Victoria', 'Victoire', 'Sieg', 'Vitória'],
  'Keep playing': ['Seguir jugando', 'Continuer', 'Weiterspielen', 'Continuar jogando'],
  'New match': ['Nueva partida', 'Nouvelle partie', 'Neues Match', 'Nova partida'],
  'Back to lobby': ['Volver a la sala', 'Retour au salon', 'Zurück zur Lobby', 'Voltar à sala'],
  'Main menu': ['Menú principal', 'Menu principal', 'Hauptmenü', 'Menu principal'],
  "You're out. Watching the rest of the round.": ['Estás fuera. Viendo el resto de la ronda.', 'Vous êtes éliminé. Vous regardez la suite.', 'Du bist raus. Du schaust den Rest der Runde zu.', 'Você saiu. Assistindo ao resto da rodada.'],
  'Click to aim': ['Haz clic para apuntar', 'Cliquez pour viser', 'Klicken zum Zielen', 'Clique para mirar'],
  'Platform edge color = height': ['Color del borde = altura', 'Couleur du bord = hauteur', 'Kantenfarbe = Höhe', 'Cor da borda = altura'],
  '1 jump up': ['1 salto', '1 saut', '1 Sprung', '1 pulo'],
  '2 jumps (needs a step)': ['2 saltos (requiere escalón)', '2 sauts (marche nécessaire)', '2 Sprünge (Stufe nötig)', '2 pulos (precisa degrau)'],
  '3 jumps (needs steps)': ['3 saltos (requiere escalones)', '3 sauts (marches nécessaires)', '3 Sprünge (Stufen nötig)', '3 pulos (precisa degraus)'],
  "Each stripe on a block's side is one jump tall.": ['Cada franja lateral mide un salto.', 'Chaque bande latérale fait un saut de haut.', 'Jeder Streifen an der Seite ist einen Sprung hoch.', 'Cada faixa lateral tem a altura de um pulo.'],
  'Block': ['Bloqueo', 'Blocage', 'Block', 'Bloqueio'],
  // practice panel
  'Hide (P)': ['Ocultar (P)', 'Masquer (P)', 'Ausblenden (P)', 'Ocultar (P)'],
  'DPS (5 s)': ['DPS (5 s)', 'DPS (5 s)', 'DPS (5 s)', 'DPS (5 s)'],
  'Total damage': ['Daño total', 'Dégâts totaux', 'Schaden gesamt', 'Dano total'],
  'Biggest hit': ['Mayor golpe', 'Plus gros coup', 'Größter Treffer', 'Maior golpe'],
  'Reset': ['Reiniciar', 'Réinitialiser', 'Zurücksetzen', 'Zerar'],
  'Your cards': ['Tus cartas', 'Vos cartes', 'Deine Karten', 'Suas cartas'],
  'Remove all': ['Quitar todas', 'Tout retirer', 'Alle entfernen', 'Remover todas'],
  'Add random': ['Añadir aleatoria', 'Ajouter au hasard', 'Zufällig hinzufügen', 'Adicionar aleatória'],
  'Add cards': ['Añadir cartas', 'Ajouter des cartes', 'Karten hinzufügen', 'Adicionar cartas'],
  'Search cards': ['Buscar cartas', 'Chercher des cartes', 'Karten suchen', 'Buscar cartas'],
  'Range': ['Campo', 'Champ', 'Platz', 'Campo'],
  'New arena': ['Nueva arena', 'Nouvelle arène', 'Neue Arena', 'Nova arena'],
  // dynamic (t())
  'Round {n}': ['Ronda {n}', 'Manche {n}', 'Runde {n}', 'Rodada {n}'],
  'Wave {n}': ['Oleada {n}', 'Vague {n}', 'Welle {n}', 'Onda {n}'],
  'Fight!': ['¡A luchar!', 'Combattez !', 'Kampf!', 'Lutem!'],
  'You won the round': ['Ganaste la ronda', 'Vous avez gagné la manche', 'Runde gewonnen', 'Você venceu a rodada'],
  '{name} wins the round': ['{name} gana la ronda', '{name} gagne la manche', '{name} gewinnt die Runde', '{name} vence a rodada'],
  'Pick {k} of {n}': ['Elección {k} de {n}', 'Choix {k} sur {n}', 'Auswahl {k} von {n}', 'Escolha {k} de {n}'],
  '{s}s left.': ['Quedan {s} s.', 'Encore {s} s.', 'Noch {s} s.', 'Faltam {s} s.'],
  'Waiting for {n} player(s) to pick a card…': ['Esperando a que {n} jugador(es) elija(n) carta…', 'En attente de {n} joueur(s) qui choisissent…', 'Warte auf {n} Spieler bei der Kartenwahl…', 'Aguardando {n} jogador(es) escolher(em)…'],
  'Card stats': ['Estadísticas', 'Statistiques', 'Werte', 'Atributos'],
  'Wins': ['Victorias', 'Victoires', 'Siege', 'Vitórias'],
  'No cards yet': ['Sin cartas aún', 'Pas encore de cartes', 'Noch keine Karten', 'Sem cartas ainda'],
  'Suggested': ['Sugerida', 'Suggérée', 'Empfohlen', 'Sugerida'],
  'Fits {names}': ['Encaja con {names}', 'Va avec {names}', 'Passt zu {names}', 'Combina com {names}'],
  'Join code': ['Código para unirse', 'Code pour rejoindre', 'Beitrittscode', 'Código para entrar'],
};

let lang = 'en', index = null;
const NATIVE = new WeakMap();   // text node / element -> its English text

export function getLang() { return lang; }
export function t(en, params) {
  let s = en;
  if (lang !== 'en' && DICT[en]) s = DICT[en][COLS.indexOf(lang)] || en;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
  return s;
}
function lookup(en) { const row = DICT[en]; return row && lang !== 'en' ? row[COLS.indexOf(lang)] : null; }

function translateText(node) {
  const raw = node.nodeValue; if (!raw || !raw.trim()) return;
  let en = NATIVE.get(node);
  const cur = raw.trim();
  // Text that changed since we last translated it is new English (or code already translated it).
  if (en == null || (cur !== en && !(DICT[en] && DICT[en].includes(cur)))) { en = cur; NATIVE.set(node, en); }
  const want = lang === 'en' ? en : lookup(en);
  if (!want) return;
  const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0], next = lead + want + trail;
  if (raw !== next) node.nodeValue = next;
}
function translateAttrs(el) {
  if (!el.getAttribute) return;
  for (const a of ['placeholder', 'title']) {
    const v = el.getAttribute(a); if (!v) continue;
    const key = 'i18n-' + a;
    let en = el.dataset ? el.dataset[key.replace(/-(\w)/g, (m, c) => c.toUpperCase())] : null;
    if (!en) { en = v; el.dataset[key.replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v; }
    const want = lang === 'en' ? en : lookup(en);
    if (want && v !== want) el.setAttribute(a, want);
  }
}
export function translateTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.closest && root.closest('[data-noi18n]')) return;
  translateAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 3) { if (!(n.parentElement && n.parentElement.closest('[data-noi18n]'))) translateText(n); }
    else translateAttrs(n);
  }
}

let observer = null;
export function setLanguage(code) {
  lang = LANGUAGES[code] ? code : 'en';
  document.documentElement.lang = lang;
  translateTree(document.body);
  if (!observer) {
    // Menus rebuilt by code (lobby, pick screen...) are translated as they appear.
    observer = new MutationObserver(list => {
      if (lang === 'en' && !index) return;
      for (const m of list) {
        if (m.type === 'characterData') translateText(m.target);
        else for (const n of m.addedNodes) translateTree(n);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  index = true;
}
export function languageOptions(selected) {
  return Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');
}
