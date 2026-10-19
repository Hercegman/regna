# The historical decisions behind the data

The map is 1080. Where the game and the history disagree, this file records
which way it was settled and why.

## The roster

73 factions, against the 21 of the genre's best known entry. The additions are
not padding: each held territory, fielded an army and conducted its own foreign
policy. They include the Croatian kingdom under Zvonimir, Ragusa, Serbia,
Bosnia, Bulgaria, Wallachia, Wales, Ireland, Norway, Sweden, Bohemia, Aragon,
Navarre, Genoa, Pisa, Florence, Georgia, Cilician Armenia, Trebizond, the Kievan
Rus, Novgorod, Muscovy, Lithuania, the Teutonic Order, the crusader states, the
military orders, the Seljuks, Rum, the Fatimids, Abbasids, Ayyubids, Mamluks and
Ottomans, the Almoravids, Almohads, Granada, the Zirids, Hafsids and Marinids,
the Cumans, Volga Bulgaria, the Mongols, the Golden Horde, the Timurids, the
Crimean Khanate, Ghana, Mali, Kanem, Makuria and Ethiopia.

## Anachronism

Nothing is backdated. A polity that did not exist in 1080 has an `appearsIn`
year and enters play then, at the seat it actually rose from. The player is told
the year on the selection screen rather than being quietly offered a faction
that cannot be played.

A few polities are given a terminal year as well, where the state genuinely
ended: the Great Seljuk Empire in 1194, the Abbasid caliphate of Baghdad in
1258, Pisa's independence in 1406.

## Ownership in 1080

Several provinces are held by someone a player might not expect, because they
were:

- **Nicaea** is Turkish. It fell within a year of the start date, and Anatolia
  was already lost.
- **Antioch, Belgrade, Nis, Skopje, Sofia and Dyrrachium** are Byzantine. The
  Balkan states that later took them did not hold them yet.
- **Tbilisi** is Seljuk. It was a Muslim emirate until David the Builder took it
  in 1122.
- **Rouen** is English. Normandy and England were one realm under the Conqueror.
- **Toledo, Valencia, Granada, Lisbon and Badajoz** are independent: taifas too
  small to warrant a faction each, and not yet Christian.
- **Wallachia and Moldavia** are Cuman. The principalities came later.
- **Orkney and the Western Isles** sit with Norway, which held them.

## Faith against ownership

A province's population has its own religion, which is frequently not its
ruler's. Anatolia under the Turks is still Orthodox, Sicily under the Normans is
still Muslim, Apulia is Greek, Prussia and Lithuania are pagan, Nubia and
Ethiopia are Miaphysite. Conversion takes generations and costs public order,
which is what made the real thing slow.

## Deliberate weaknesses

The Cuman confederation has no siege engines and cannot be given any. It raided
and extorted but never reduced a fortified city, and the test suite asserts that
this stays true rather than being quietly patched by a later edit.

## Where the game wins over the record

- **Zaragoza** starts as a taifa, though by 1080 it was paying tribute to
  Castile. A tributary that cannot act is not interesting to play.
- **Antioch and Jerusalem** are grandfathered as crusader states from 1098 and
  1099 rather than requiring the First Crusade to be scripted.
- **Khwarazm** emerges at Derbent, the eastern edge of the map, because its
  homeland in Transoxiana is off it.
- **Moscow** exists as a province from the start under the name of its land,
  although the town was founded in 1147. The ground was there.

## The waters

Thirty-five zones, named as the period named them where it had a name and
geographically where it did not. Five are cut off from the Mediterranean and
stay that way, each for a real reason: the Caspian and the Volga are a closed
basin, Mesopotamia reaches the Gulf beyond the edge of the map, the Red Sea had
no canal until the nineteenth century, and the Niger's inland delta reaches no
ocean a galley can use.

Ships are gated by era and by water. The longship goes out of use after 1270,
the cog arrives in 1180, the carrack in 1400 and the galleass in 1450. The
dromon with its Greek fire belongs to Byzantium and Trebizond alone and is gone
by 1350. A river galley cannot be built at Venice and a carrack cannot be
floated down the Tigris.

## Units

Unit rosters are assembled from pools rather than written per faction, so a
faction's army list follows from its culture and its historical character:
England and Wales draw the longbow, Genoa alone fields its crossbowmen, the
steppe hordes have no infantry of their own and conscript the towns they take,
Switzerland and Burgundy get the pike square, Bohemia gets the Hussite
handgunner in 1415 and nobody else does.
