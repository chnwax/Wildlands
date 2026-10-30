# Audyt modeli Idyllic Anime Japan (309)

Stan po wymianie assetów w Sakuragawa. „Użyty”: TAK (liczba wystąpień w mieście) / wczytany (w tools/packs.json, gotowy do użycia) / nie.
Domy mieszkalne celowo nieużyte (osobne przyszłe osiedle). Liczby z działającej gry (props + zestawy instancjonowane).
Użytych modeli: **109** z 309.

| model | kategoria | wymiary (m) | trójkąty | co to | pasuje? | użyty | gdzie / dlaczego nie | materiał | instancjonowanie |
|---|---|---|---|---|---|---|---|---|---|
| airconditioner_01 | urban_ulica | 0.94×0.87×0.39 | 354 | jednostka zewnętrzna klimatyzacji | tak | TAK (1688) | ściany boczne/tylne domów, bloków, sklepów, konbini (building.js acUnit) | ok | tak |
| airconditioner_02 | urban_ulica | 1.24×1.23×0.57 | 668 | jednostka zewnętrzna klimatyzacji | tak | TAK (363) | ściany boczne/tylne domów, bloków, sklepów, konbini (building.js acUnit) | ok | tak |
| antenna_01 | urban_ulica | 1.78×2.10×1.08 | 580 | antena TV | tak | TAK (159) | nieużyte — dachy mają anteny proceduralne (kandydat) | ok | tak |
| antenna_02 | urban_ulica | 1.28×2.26×1.08 | 340 | antena TV | tak | TAK (183) | nieużyte — dachy mają anteny proceduralne (kandydat) | ok | tak |
| apartment_building_01 | domy | 12.18×28.95×8.05 | 53996 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| apartment_building_02 | domy | 9.52×19.46×9.72 | 31284 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| apartment_building_03 | domy | 12.18×16.64×8.05 | 30728 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| apartment_building_04 | domy | 11.05×24.21×8.47 | 28014 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| apartment_building_05 | domy | 11.05×44.43×8.47 | 53110 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| asphalt_circle | urban_ulica | 38.01×0.00×35.37 | 40 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| bicycle | pojazdy | 2.32×1.38×0.60 | 3832 | rower | tak | TAK (3) | używany wariant bicycle_1 (srebrny, barwiony per rower) | ok | tak |
| bicycle_1 | pojazdy | 2.32×1.38×0.60 | 3832 | rower | tak | TAK | rowery parkujące (townkit bicycles, bliski LOD, barwione) | ok | tak |
| bicycle_2 | pojazdy | 2.32×1.38×0.60 | 3832 | rower | tak | wczytany | używany wariant bicycle_1 (srebrny, barwiony per rower) | ok | tak |
| bikestand | urban_ulica | 0.76×0.55×1.74 | 3528 | stojak rowerowy | tak | TAK (4) | przed konbini | ok | tak |
| blockade_train_01 | kolej | 1.59×1.08×0.03 | 52 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| blockade_train_02 | kolej | 1.19×0.72×0.45 | 68 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| blockade_train_03 | kolej | 1.22×0.72×0.27 | 12 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| board_digital_01 | znaki_i_szyldy | 0.66×1.12×0.70 | 558 | potykacz / tablica menu | tak | wczytany | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| board_digital_02 | znaki_i_szyldy | 0.76×0.97×0.73 | 668 | potykacz / tablica menu | tak | wczytany | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| board_digital_03 | znaki_i_szyldy | 0.96×2.19×0.71 | 422 | potykacz / tablica menu | tak | nie | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| board_foldable_01 | znaki_i_szyldy | 0.55×0.96×0.46 | 96 | potykacz / tablica menu | tak | TAK (4) | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| board_foldable_02 | znaki_i_szyldy | 0.62×1.11×0.49 | 108 | potykacz / tablica menu | tak | TAK (4) | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| board_foldable_03 | znaki_i_szyldy | 0.58×1.01×0.49 | 96 | potykacz / tablica menu | tak | TAK (4) | przed otwartymi sklepami (ramen/sushi własne) | ok | tak |
| book_shelf_01 | dekoracje | 0.94×2.30×0.65 | 1596 | regał | tak | nie | shelf_wooden: regały z papierosami i gazetami w konbini; book_shelf — kandydat do księgarni | ok | tak |
| book_shelf_02 | dekoracje | 1.22×2.30×0.65 | 1976 | regał | tak | nie | shelf_wooden: regały z papierosami i gazetami w konbini; book_shelf — kandydat do księgarni | ok | tak |
| bottle_drink_01 | dekoracje | 0.11×0.41×0.11 | 108 | butelka napoju | tak | TAK (316) | regały z napojami w konbini (~1200 szt.) | ok | tak |
| bottle_drink_02 | dekoracje | 0.11×0.31×0.11 | 156 | butelka napoju | tak | TAK (355) | regały z napojami w konbini (~1200 szt.) | ok | tak |
| bottle_drink_03 | dekoracje | 0.09×0.32×0.09 | 78 | butelka napoju | tak | TAK (258) | regały z napojami w konbini (~1200 szt.) | ok | tak |
| bottle_drink_04 | dekoracje | 0.11×0.18×0.11 | 60 | butelka napoju | tak | TAK (290) | regały z napojami w konbini (~1200 szt.) | ok | tak |
| broom_stick | dekoracje | 0.28×1.83×0.12 | 408 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (4) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| bucket | dekoracje | 0.39×0.34×0.39 | 580 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (124) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| bush_01 | roslinnosc | 2.77×1.34×2.59 | 360 | krzak / trawa / liście | nie | wczytany | trawa, kwiaty i runo zostają proceduralne (prośba użytkownika) | — | — |
| cable_line_01 | urban_ulica | 1.32×0.68×10.95 | 312 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cable_line_02 | urban_ulica | 1.32×0.27×10.84 | 168 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cable_line_03 | urban_ulica | 1.32×0.02×10.96 | 24 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cable_single | urban_ulica | 0.02×0.27×10.84 | 42 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cables_hanging_01 | urban_ulica | 4.36×0.68×0.02 | 216 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cables_hanging_02 | urban_ulica | 3.87×0.90×0.03 | 288 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cables_hanging_03 | urban_ulica | 3.66×0.84×0.03 | 624 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| cables_trainlines | kolej | 0.72×0.55×7.84 | 224 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| carton_01 | dekoracje | 0.85×0.45×0.55 | 68 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (12) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| carton_02 | dekoracje | 1.32×0.46×1.14 | 84 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (14) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| carton_03 | dekoracje | 0.48×0.38×0.46 | 68 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (45) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| chair | dekoracje | 0.54×0.76×0.54 | 108 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | wczytany | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| chair_02 | dekoracje | 0.52×1.31×0.56 | 112 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | wczytany | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| chopsticks | dekoracje | 0.07×0.04×0.30 | 36 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| cloth_storefront_01 | znaki_i_szyldy | 4.73×1.26×0.10 | 1558 | noren z nadrukiem | tak | wczytany | nad drzwiami jadłodajni wg branży | ok | tak |
| cloth_storefront_02 | znaki_i_szyldy | 3.76×1.26×0.13 | 1178 | noren z nadrukiem | tak | TAK (2) | nad drzwiami jadłodajni wg branży | ok | tak |
| cloth_storefront_03 | znaki_i_szyldy | 4.94×0.92×0.11 | 1966 | noren z nadrukiem | tak | TAK (1) | nad drzwiami jadłodajni wg branży | ok | tak |
| convenience_store | budynki | 12.13×5.26×8.89 | 7116 | pusta bryła konbini | częściowo | nie | konbini ma własną (większą) bryłę + pełne wnętrze z modeli paczki (js/konbini.js) | ok | tak |
| cornerwall | ogrodzenia_i_mury | 8.88×3.12×4.99 | 28 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| counter_shop | dekoracje | 4.81×1.12×1.46 | 44 | wyposażenie sklepu | tak | TAK (1) | konbini: lada, regały ścienne, gondole (table_shop — kandydat) | ok | tak |
| curbs_01 | urban_ulica | 5.01×0.15×0.27 | 60 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| curbs_02 | urban_ulica | 2.00×0.15×0.27 | 24 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| drain_street | urban_ulica | 0.75×0.04×0.52 | 106 | kratka ściekowa | nie | wczytany | kratki proceduralne pasują do 30 cm opaski i L-rynny; model paczki jest za szeroki (0.75 m) | — | — |
| entrance_edge | ogrodzenia_i_mury | 0.13×1.52×0.13 | 34 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| entrance_fence | ogrodzenia_i_mury | 0.89×1.36×0.13 | 266 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| entrance_fence_02 | ogrodzenia_i_mury | 1.39×1.09×0.09 | 232 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| entrance_fence_03 | ogrodzenia_i_mury | 0.89×1.40×0.07 | 224 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_01 | ogrodzenia_i_mury | 2.41×1.11×0.06 | 276 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_02 | ogrodzenia_i_mury | 1.24×1.11×0.06 | 696 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_03 | ogrodzenia_i_mury | 2.23×1.06×0.05 | 476 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_04 | ogrodzenia_i_mury | 2.23×1.06×0.05 | 404 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_05 | ogrodzenia_i_mury | 1.93×1.07×0.04 | 224 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_06 | ogrodzenia_i_mury | 1.92×1.08×0.06 | 116 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| fence_07 | ogrodzenia_i_mury | 1.85×1.15×0.05 | 156 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| firehydrant | urban_ulica | 0.92×1.19×0.42 | 1302 | hydrant naziemny | tak | TAK (9) | chodniki (town.js), przodem do jezdni | ok | tak |
| flowerpot_01 | dekoracje | 0.61×0.93×0.58 | 766 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (52) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_010 | dekoracje | 0.70×0.60×0.64 | 452 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (69) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_02 | dekoracje | 0.54×0.72×0.59 | 530 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (58) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_03 | dekoracje | 0.33×0.34×0.33 | 122 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (49) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_04 | dekoracje | 0.47×0.92×0.41 | 600 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (57) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_05 | dekoracje | 0.36×0.68×0.35 | 356 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (56) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_06 | dekoracje | 0.70×0.51×0.66 | 408 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (60) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_07 | dekoracje | 0.46×0.56×0.43 | 1184 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (52) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_08 | dekoracje | 0.28×0.43×0.28 | 342 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (43) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_09 | dekoracje | 0.46×0.26×0.43 | 224 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (66) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| flowerpot_10 | dekoracje | 0.59×0.93×0.59 | 946 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | nie | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| fusebox_large | urban_ulica | 1.06×1.68×0.48 | 218 | szafa techniczna | tak | TAK (2) | tył konbini, jako bankomat/ksero w konbini | ok | tak |
| fusebox_wall_01 | ogrodzenia_i_mury | 0.33×0.82×0.19 | 478 | licznik / skrzynka na ścianie | tak | TAK (429) | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_02 | ogrodzenia_i_mury | 0.30×0.56×0.16 | 70 | licznik / skrzynka na ścianie | tak | TAK (525) | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_03 | ogrodzenia_i_mury | 0.41×0.28×0.28 | 230 | licznik / skrzynka na ścianie | tak | TAK (985) | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_04 | ogrodzenia_i_mury | 0.48×1.48×0.17 | 425 | licznik / skrzynka na ścianie | tak | nie | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_07 | ogrodzenia_i_mury | 0.94×1.36×0.25 | 604 | licznik / skrzynka na ścianie | tak | nie | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_08 | ogrodzenia_i_mury | 0.49×0.64×0.25 | 100 | licznik / skrzynka na ścianie | tak | nie | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| fusebox_wall_09 | ogrodzenia_i_mury | 0.29×0.31×0.15 | 182 | licznik / skrzynka na ścianie | tak | TAK (402) | 01/02/09: liczniki prądu, 03: licznik gazu (building.js meterBox); 04/07/08 — kandydaci | ok | tak |
| gate_train | kolej | 5.38×0.21×0.55 | 488 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| gatelift | kolej | 0.76×0.97×0.67 | 146 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| grass_patch_large | roslinnosc | 2.14×0.50×2.17 | 280 | krzak / trawa / liście | nie | nie | trawa, kwiaty i runo zostają proceduralne (prośba użytkownika) | — | — |
| grass_patch_small | roslinnosc | 0.83×0.49×0.84 | 30 | krzak / trawa / liście | nie | nie | trawa, kwiaty i runo zostają proceduralne (prośba użytkownika) | — | — |
| house_residential_attachment_01 | domy | 6.46×5.43×7.55 | 7670 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| house_residential_building_01 | domy | 9.29×9.25×8.52 | 12399 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| house_residential_building_02 | domy | 7.80×7.97×10.15 | 10886 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| house_residential_building_03 | domy | 7.86×5.93×8.23 | 6752 | dom mieszkalny / blok | NIE (brief) | nie | zarezerwowane na przyszłe osiedle — domy w mieście zostają proceduralne | — | tak (budynek) |
| knife_01 | dekoracje | 0.46×0.15×0.03 | 48 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| knife_02 | dekoracje | 0.46×0.09×0.03 | 80 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| lamp_01 | urban_ulica | 0.75×0.70×0.40 | 591 | oprawa lampy | tak, ale | wczytany | na słupach używany lamp_02; reszta — kandydaci do latarni parkowych | emisja nocą | tak |
| lamp_02 | urban_ulica | 1.63×1.00×0.32 | 362 | oprawa lampy ulicznej | tak | TAK (222) | lampy na słupach energetycznych (townkit packPole), świeci nocą | emisja nocą | tak |
| lamp_03 | urban_ulica | 0.39×0.35×0.40 | 582 | oprawa lampy | tak, ale | wczytany | na słupach używany lamp_02; reszta — kandydaci do latarni parkowych | emisja nocą | tak |
| lamp_04 | urban_ulica | 0.45×0.59×0.39 | 320 | oprawa lampy | tak, ale | wczytany | na słupach używany lamp_02; reszta — kandydaci do latarni parkowych | emisja nocą | tak |
| lantern_traditional_01 | dekoracje | 0.29×1.46×0.29 | 368 | papierowy lampion | tak | wczytany | przy wejściach ramen/izakaya/soba/sushi/sake; świeci nocą | emisja nocą | tak |
| lantern_traditional_02 | dekoracje | 0.42×1.63×0.42 | 456 | papierowy lampion | tak | TAK (1) | przy wejściach ramen/izakaya/soba/sushi/sake; świeci nocą | emisja nocą | tak |
| lantern_traditional_03 | dekoracje | 0.42×1.63×0.42 | 456 | papierowy lampion | tak | wczytany | przy wejściach ramen/izakaya/soba/sushi/sake; świeci nocą | emisja nocą | tak |
| lantern_traditional_04 | dekoracje | 0.49×1.64×0.50 | 456 | papierowy lampion | tak | TAK (1) | przy wejściach ramen/izakaya/soba/sushi/sake; świeci nocą | emisja nocą | tak |
| leaves_ground | roslinnosc | 1.63×0.07×1.55 | 138 | krzak / trawa / liście | nie | nie | trawa, kwiaty i runo zostają proceduralne (prośba użytkownika) | — | — |
| mailbox_post | urban_ulica | 0.51×1.28×0.45 | 376 | czerwona skrzynka pocztowa | tak | TAK (4) | główna ulica (towndeco postBox) | ok | tak |
| mailbox_resident_01 | dekoracje | 0.39×0.46×0.14 | 92 | skrzynka domowa | tak | TAK (187) | przy furtkach działek (towndeco mailbox) | ok | tak |
| mailbox_resident_02 | dekoracje | 0.43×0.34×0.10 | 64 | skrzynka domowa | tak | TAK (262) | przy furtkach działek (towndeco mailbox) | ok | tak |
| manhole | urban_ulica | 0.84×0.04×0.84 | 262 | właz kanalizacyjny 3D | nie | nie | włazy są naklejkami na jezdni z herbem miasta (podążają za spadkiem); model 3D sterczałby 4 cm | — | — |
| mirror_round_01 | urban_ulica | 0.87×0.87×0.33 | 716 | lustro drogowe | tak | wczytany | zakręty i wyjazdy (02 pojedyncze, 03 podwójne); 01 — wariant zapasowy | lustro metaliczne | tak |
| mirror_round_02 | urban_ulica | 0.87×3.34×0.36 | 744 | lustro drogowe | tak | TAK (14) | zakręty i wyjazdy (02 pojedyncze, 03 podwójne); 01 — wariant zapasowy | lustro metaliczne | tak |
| mirror_round_03 | urban_ulica | 0.77×3.36×0.84 | 1048 | lustro drogowe | tak | TAK (31) | zakręty i wyjazdy (02 pojedyncze, 03 podwójne); 01 — wariant zapasowy | lustro metaliczne | tak |
| mofa_vehicle | pojazdy | 2.12×1.44×0.93 | 4462 | skuter | tak | TAK (2) | dress.js (2 szt.) — można dodać więcej przy sklepach | ok | tak |
| mofa_vehicle_1 | pojazdy | 2.12×1.44×0.93 | 4462 | skuter | tak | wczytany | dress.js (2 szt.) — można dodać więcej przy sklepach | ok | tak |
| mofa_vehicle_2 | pojazdy | 2.12×1.44×0.93 | 4462 | skuter | tak | wczytany | dress.js (2 szt.) — można dodać więcej przy sklepach | ok | tak |
| plane_clouds | efekty_i_niebo | 12.35×12.35×0.00 | 2 | płaszczyzna chmur | nie | nie | niebo i chmury są własne | — | — |
| plants_box_01 | dekoracje | 0.74×0.78×0.59 | 632 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (6) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| plants_box_02 | dekoracje | 0.64×1.18×0.66 | 240 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (5) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| plants_box_03 | dekoracje | 1.20×1.15×0.67 | 392 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (15) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| plate_wooden_01 | dekoracje | 0.56×0.04×0.39 | 28 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| platform_01 | urban_ulica | 7.68×2.00×7.68 | 506 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| pole_street | urban_ulica | 0.17×1.04×0.17 | 164 | słupek | tak, ale | wczytany | słupki są proceduralne (bollard) — kandydat | ok | tak |
| pot01 | dekoracje | 0.59×0.34×0.47 | 580 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| pot02 | dekoracje | 0.66×0.22×0.33 | 406 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| powerline_train | kolej | 0.83×4.81×0.13 | 120 | kable / linie | nie | nie | przewody są generowane między zmierzonymi punktami słupów (zwis, przyłącza) — gotowe kable mają stałą długość | — | — |
| railway_train | kolej | 2.19×0.22×5.33 | 592 | pociąg / tory | nie | nie | kolej, tory i pociągi zostają (brief); własne modele pociągów | — | — |
| ramenbowl | dekoracje | 0.41×0.35×0.44 | 636 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| ramenshop | budynki | 6.52×4.49×4.59 | 14712 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| restaurant_traditional_building | budynki | 8.49×8.03×8.33 | 23852 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| rice_curry_dish | dekoracje | 0.54×0.11×0.54 | 504 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| shelf_wooden | dekoracje | 1.22×2.30×0.65 | 76 | regał | tak | TAK (9) | shelf_wooden: regały z papierosami i gazetami w konbini; book_shelf — kandydat do księgarni | ok | tak |
| shelves_store | dekoracje | 3.65×2.63×0.81 | 200 | wyposażenie sklepu | tak | TAK (25) | konbini: lada, regały ścienne, gondole (table_shop — kandydat) | ok | tak |
| shop_building_01 | budynki | 6.39×8.46×7.74 | 14838 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| shop_building_02 | budynki | 6.97×9.67×6.97 | 18172 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| shop_building_03 | budynki | 5.68×9.67×7.56 | 4340 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| shop_building_04 | budynki | 6.29×9.67×8.08 | 21178 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| shop_building_05 | budynki | 6.45×8.46×7.74 | 14262 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| sidewalk_corner | urban_ulica | 3.27×0.15×3.10 | 74 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_curve | urban_ulica | 2.10×0.15×2.10 | 198 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_curve_01 | urban_ulica | 10.22×0.15×1.95 | 268 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_curve_02 | urban_ulica | 10.31×0.15×2.82 | 268 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_curve_03 | urban_ulica | 5.16×0.15×2.82 | 130 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_island | urban_ulica | 14.15×0.15×8.54 | 1524 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_island_large | urban_ulica | 26.38×0.15×16.15 | 1760 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_long | urban_ulica | 24.98×0.15×3.34 | 610 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_straight | urban_ulica | 5.02×0.15×1.55 | 122 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_thin_long | urban_ulica | 20.02×0.15×1.55 | 488 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sidewalk_wide | urban_ulica | 5.02×0.15×3.34 | 122 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sign_3d_chinesefood | znaki_i_szyldy | 5.02×1.17×0.15 | 1608 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_3d_flowerstore | znaki_i_szyldy | 2.40×1.11×0.13 | 444 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_3d_karaoke | znaki_i_szyldy | 4.18×1.00×0.13 | 776 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_3d_konbini | znaki_i_szyldy | 4.66×1.08×0.16 | 284 | litery 3D コンビニ | tak | TAK (1) | ściana boczna konbini | ok | tak |
| sign_3d_library | znaki_i_szyldy | 3.07×0.97×0.16 | 2416 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_3d_manga | znaki_i_szyldy | 4.14×0.96×0.13 | 280 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_3d_postoffice | znaki_i_szyldy | 4.52×1.80×0.16 | 3376 | napis 3D (karaoke, biblioteka, poczta...) | tak, ale | nie | brak takich budynków w mieście — kandydaci (poczta, biblioteka) | ok | tak |
| sign_streetname_01 | znaki_i_szyldy | 1.13×3.34×0.14 | 188 | tabliczka z nazwą ulicy | tak | TAK (12) | przed skrzyżowaniami ulic z chodnikami | ok | tak |
| sign_streetname_02 | znaki_i_szyldy | 1.13×3.34×0.14 | 188 | tabliczka z nazwą ulicy | tak | TAK (11) | przed skrzyżowaniami ulic z chodnikami | ok | tak |
| sign_streetname_03 | znaki_i_szyldy | 1.13×3.34×0.14 | 188 | tabliczka z nazwą ulicy | tak | TAK (11) | przed skrzyżowaniami ulic z chodnikami | ok | tak |
| sign_traffic_001 | znaki_i_szyldy | 0.60×2.86×0.11 | 204 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_002 | znaki_i_szyldy | 0.60×2.86×0.11 | 204 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_003 | znaki_i_szyldy | 0.60×2.86×0.11 | 204 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_003_1 | znaki_i_szyldy | 0.60×2.86×0.11 | 204 | znak drogowy | tak | nie | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_004 | znaki_i_szyldy | 0.61×2.82×0.11 | 280 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_005 | znaki_i_szyldy | 0.60×2.82×0.11 | 280 | znak drogowy | tak | TAK (2) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_006 | znaki_i_szyldy | 0.61×2.82×0.11 | 280 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_007 | znaki_i_szyldy | 0.61×2.74×0.10 | 228 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_008 | znaki_i_szyldy | 0.61×2.74×0.10 | 152 | znak drogowy | tak | TAK (129) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_009 | znaki_i_szyldy | 0.61×2.93×0.11 | 228 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_010 | znaki_i_szyldy | 0.63×2.87×0.10 | 172 | znak drogowy | tak | TAK (3) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_011 | znaki_i_szyldy | 0.63×2.87×0.10 | 172 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_012 | znaki_i_szyldy | 0.54×2.83×0.10 | 172 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_013 | znaki_i_szyldy | 0.60×2.93×0.11 | 172 | znak drogowy | tak | TAK (5) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_014 | znaki_i_szyldy | 0.56×3.02×0.11 | 208 | znak drogowy | tak | TAK (90) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_015 | znaki_i_szyldy | 0.44×2.23×0.10 | 172 | znak drogowy | tak | wczytany | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_016 | znaki_i_szyldy | 0.48×2.21×0.12 | 248 | znak drogowy | tak | TAK (10) | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_traffic_017 | znaki_i_szyldy | 0.46×2.04×0.09 | 172 | znak drogowy | tak | nie | stop, 30, przejście, sygnalizacja, strefa szkolna; inne — gdy pojawią się takie miejsca | ok | tak |
| sign_train_01 | kolej | 0.66×1.65×0.08 | 24 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| sign_train_02 | kolej | 0.66×1.41×0.08 | 24 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| sign_train_03 | kolej | 0.69×0.24×0.02 | 12 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| signboard_small_01 | znaki_i_szyldy | 1.23×1.10×0.74 | 120 | szyld (mały/szeroki) | tak, ale | wczytany | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_small_02 | znaki_i_szyldy | 1.16×1.21×0.43 | 316 | szyld (mały/szeroki) | tak, ale | wczytany | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_small_04 | znaki_i_szyldy | 1.33×0.90×0.27 | 292 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_small_05 | znaki_i_szyldy | 1.52×0.70×0.21 | 308 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_small_06 | znaki_i_szyldy | 1.21×0.74×0.34 | 148 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_small_09 | znaki_i_szyldy | 1.37×1.24×0.07 | 308 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_vertical_01 | znaki_i_szyldy | 1.36×2.62×0.43 | 180 | pionowy szyld wysięgnikowy | tak | TAK (1) | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_vertical_02 | znaki_i_szyldy | 1.30×2.62×0.43 | 220 | pionowy szyld wysięgnikowy | tak | nie | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_vertical_03 | znaki_i_szyldy | 1.56×2.52×0.45 | 164 | pionowy szyld wysięgnikowy | tak | wczytany | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_vertical_04 | znaki_i_szyldy | 1.23×2.47×0.38 | 372 | pionowy szyld wysięgnikowy | tak | TAK (1) | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_vertical_05 | znaki_i_szyldy | 1.42×2.62×0.43 | 212 | pionowy szyld wysięgnikowy | tak | nie | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_vertical_06 | znaki_i_szyldy | 1.35×2.52×0.45 | 148 | pionowy szyld wysięgnikowy | tak | nie | 01 drogeria, 03 chińska/ramen, 04 izakaya; pozostałe — kandydaci | ok | tak |
| signboard_wide_01 | znaki_i_szyldy | 3.10×1.03×0.24 | 332 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_wide_02 | znaki_i_szyldy | 3.19×1.08×0.41 | 156 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_wide_03 | znaki_i_szyldy | 3.79×1.28×0.39 | 52 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_wide_04 | znaki_i_szyldy | 3.79×1.28×0.30 | 52 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| signboard_wide_05 | znaki_i_szyldy | 3.79×1.28×0.40 | 182 | szyld (mały/szeroki) | tak, ale | nie | szyldy sklepów mają własne nazwy (canvas) — kandydaci do bocznych uliczek | ok | tak |
| soup | dekoracje | 0.19×0.10×0.18 | 164 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| soysauce | dekoracje | 0.12×0.26×0.12 | 176 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| stairs_01 | urban_ulica | 1.24×1.62×3.38 | 322 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| stairs_wide | urban_ulica | 7.01×1.05×3.86 | 184 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sticker_atm | znaki_i_szyldy | 0.33×0.33×0.00 | 2 | naklejka na szybę | tak | TAK (1) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_open | znaki_i_szyldy | 0.23×0.29×0.00 | 2 | naklejka na szybę | tak | TAK (21) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_01 | znaki_i_szyldy | 0.59×0.46×0.00 | 2 | naklejka na szybę | tak | TAK (6) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_02 | znaki_i_szyldy | 0.59×0.51×0.00 | 2 | naklejka na szybę | tak | TAK (4) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_03 | znaki_i_szyldy | 0.60×0.40×0.00 | 2 | naklejka na szybę | tak | TAK (3) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_04 | znaki_i_szyldy | 0.33×0.33×0.00 | 2 | naklejka na szybę | tak | TAK (9) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_05 | znaki_i_szyldy | 0.31×0.25×0.00 | 2 | naklejka na szybę | tak | TAK (5) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_ads | znaki_i_szyldy | 1.52×0.46×0.00 | 2 | naklejka na szybę | tak | TAK (5) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_store_ads_02 | znaki_i_szyldy | 1.52×0.46×0.00 | 2 | naklejka na szybę | tak | TAK (7) | szyby otwartych sklepów i konbini | ok | tak |
| sticker_tobacco | znaki_i_szyldy | 0.43×0.17×0.00 | 2 | naklejka na szybę | tak | TAK (1) | szyby otwartych sklepów i konbini | ok | tak |
| stool_01 | dekoracje | 0.50×0.92×0.49 | 288 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (5) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| stool_02 | dekoracje | 0.45×0.86×0.45 | 188 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (2) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| store_rowbuilding_01 | budynki | 5.51×10.93×7.43 | 4616 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| store_rowbuilding_02 | budynki | 5.45×11.43×7.75 | 5682 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| store_rowbuilding_03 | budynki | 5.49×12.06×7.24 | 4826 | gotowy budynek sklepu/restauracji | tak, ale | nie | kandydat do przyszłej wymiany części sklepów (21 sklepów ma edycje WB — wymiana zmieniłaby ich geometrię) | ok | tak |
| street_1 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_1 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_10 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_11 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_12 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_13 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_3 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_4 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_4_1 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| street_decal_9 | urban_ulica | 5.00×0.00×5.00 | 2 | kawałek ulicy / chodnika / krawężnika | nie | nie | drogi, chodniki i krawężniki są generowane z profili (roads.js / footways.js) — kafle paczki nie pasują do sieci | — | — |
| sunscreen_shop_01 | znaki_i_szyldy | 5.55×1.45×1.16 | 780 | markiza sklepu | tak | TAK (3) | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_shop_02 | znaki_i_szyldy | 1.75×0.65×0.78 | 44 | markiza sklepu | tak | wczytany | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_shop_03 | znaki_i_szyldy | 4.58×1.74×1.32 | 96 | markiza sklepu | tak | TAK (3) | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_shop_04 | znaki_i_szyldy | 5.42×0.92×1.86 | 136 | markiza sklepu | tak | TAK (2) | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_shop_05 | znaki_i_szyldy | 4.29×0.90×1.97 | 268 | markiza sklepu | tak | TAK (2) | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_shop_06 | znaki_i_szyldy | 4.56×0.89×1.52 | 184 | markiza sklepu | tak | TAK (2) | zamiast proceduralnej markizy, wg jej koloru | ok | tak |
| sunscreen_window_01 | znaki_i_szyldy | 2.99×0.33×1.16 | 72 | daszek nad oknem | tak, ale | nie | kandydat do okien domów (domy bez zmian wg briefu) | ok | tak |
| sunscreen_window_02 | znaki_i_szyldy | 4.75×0.10×0.94 | 512 | daszek nad oknem | tak, ale | nie | kandydat do okien domów (domy bez zmian wg briefu) | ok | tak |
| sunscreen_window_03 | znaki_i_szyldy | 3.47×0.40×0.66 | 332 | daszek nad oknem | tak, ale | nie | kandydat do okien domów (domy bez zmian wg briefu) | ok | tak |
| sushi_plate | dekoracje | 0.53×0.08×0.36 | 908 | naczynia / jedzenie | tak, ale | nie | wnętrza restauracji to malowane tło za szybą — kandydat, gdy dostaną prawdziwe wnętrza jak konbini | ok | tak |
| table_01 | dekoracje | 1.13×1.09×1.06 | 92 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | wczytany | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| table_shop | dekoracje | 1.82×1.05×0.93 | 108 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | wczytany | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| traffic_pylon | urban_ulica | 0.46×0.62×0.49 | 174 | pachołek | tak | TAK (3) | parking konbini (dress.js) | ok | tak |
| trafficlight_cars | urban_ulica | 3.00×4.61×0.96 | 5640 | sygnalizator z masztem | częściowo | nie | maszty proceduralne (zmienna długość wysięgnika); używane same głowice | ok | tak |
| trafficlight_cars_0 | urban_ulica | 2.78×0.86×0.96 | 3656 | głowica sygnalizatora | tak | TAK (4) | skrzyżowanie A×B; lampy faz siedzą w zmierzonych soczewkach | lampy własne | tak |
| trafficlight_pedestrian_01 | urban_ulica | 0.33×0.66×0.41 | 1016 | głowica sygnalizatora | tak | TAK (8) | skrzyżowanie A×B; lampy faz siedzą w zmierzonych soczewkach | lampy własne | tak |
| trafficlight_pedestrian_02 | urban_ulica | 0.33×3.23×0.41 | 1044 | sygnalizator z masztem | częściowo | nie | maszty proceduralne (zmienna długość wysięgnika); używane same głowice | ok | tak |
| trafficlight_pole | urban_ulica | 0.51×4.61×0.58 | 1984 | sygnalizator z masztem | częściowo | nie | maszty proceduralne (zmienna długość wysięgnika); używane same głowice | ok | tak |
| train_japan_01 | pojazdy | 3.81×5.04×11.21 | 35078 | pociąg / tory | nie | nie | kolej, tory i pociągi zostają (brief); własne modele pociągów | — | — |
| train_japan_01_1 | pojazdy | 3.81×5.04×11.21 | 35078 | pociąg / tory | nie | nie | kolej, tory i pociągi zostają (brief); własne modele pociągów | — | — |
| train_japan_01_windows | pojazdy | 3.81×5.04×11.21 | 36204 | pociąg / tory | nie | nie | kolej, tory i pociągi zostają (brief); własne modele pociągów | — | — |
| traincrossing_cross | kolej | 1.33×4.29×0.77 | 1320 | przejazd kolejowy (rogatki, krzyż, znaki) | tak, ale | nie | przejazdy mają animowane rogatki i migające światła (logika) — kandydat do wymiany jak sygnalizacja | ok | tak |
| trash_can_01 | urban_ulica | 0.69×1.14×0.69 | 1176 | kosz / pojemnik | tak | TAK (27) | przy automatach, konbini, stacji, parkach (dress.js, konbini.js); trash_container — kandydat do punktów śmieci | ok | tak |
| trash_can_02 | urban_ulica | 0.64×0.93×0.64 | 1176 | kosz / pojemnik | tak | TAK (1) | przy automatach, konbini, stacji, parkach (dress.js, konbini.js); trash_container — kandydat do punktów śmieci | ok | tak |
| trash_container_01 | urban_ulica | 0.70×1.25×0.76 | 998 | kosz / pojemnik | tak | wczytany | przy automatach, konbini, stacji, parkach (dress.js, konbini.js); trash_container — kandydat do punktów śmieci | ok | tak |
| trash_container_02 | urban_ulica | 0.64×0.98×0.69 | 998 | kosz / pojemnik | tak | nie | przy automatach, konbini, stacji, parkach (dress.js, konbini.js); trash_container — kandydat do punktów śmieci | ok | tak |
| trash_recycling | urban_ulica | 0.62×1.19×0.50 | 510 | kosz / pojemnik | tak | TAK (61) | przy automatach, konbini, stacji, parkach (dress.js, konbini.js); trash_container — kandydat do punktów śmieci | ok | tak |
| tree_cherry | drzewa | 4.30×6.24×3.88 | 2704 | drzewo ogrodowe / sakura | tak | TAK | drzewa (trees.js): sakury | ok, barwione | tak |
| tree_cherry_02 | drzewa | 4.25×5.74×3.66 | 2468 | drzewo ogrodowe / sakura | tak | TAK | drzewa (trees.js): sakury, sady czereśniowe | ok, barwione | tak |
| tree_garden | drzewa | 4.80×4.25×3.17 | 3216 | drzewo ogrodowe / sakura | tak | TAK (26) | drzewa (trees.js): sosny japońskie w ogrodach + sady (zamiast drzew POLYGON Farm) | ok, barwione | tak |
| tree_tall_01 | drzewa | 4.75×7.74×4.30 | 2632 | wysokie drzewo liściaste | tak | TAK | drzewa (trees.js): zelkowy w mieście | ok, barwione | tak (LOD + karty) |
| tree_tall_02 | drzewa | 4.00×6.94×4.68 | 2468 | wysokie drzewo liściaste | tak | TAK | drzewa (trees.js): zelkowy w mieście | ok, barwione | tak (LOD + karty) |
| trowel_01 | dekoracje | 0.34×0.56×0.20 | 268 | drobny rekwizyt (miotła, wiadro, doniczka, skrzynka, stołek, karton) | tak | TAK (62) | dress.js: podwórka, wejścia sklepów, konbini, ogródki; kartony/stołki także | ok | tak |
| utility_pole_01 | urban_ulica | 1.63×4.87×0.77 | 1516 | słup energetyczny | tak | TAK (41) | słupy energetyczne (wiejskie/z transformatorem) | ok | tak |
| utility_pole_02 | urban_ulica | 1.07×6.90×1.64 | 5842 | słup energetyczny | tak | TAK (46) | wszystkie słupy miasta; przewody zaczepione w zmierzonych izolatorach | ok | tak |
| utility_pole_03 | urban_ulica | 1.81×6.82×1.55 | 2930 | słup energetyczny | tak | TAK (114) | wszystkie słupy miasta; przewody zaczepione w zmierzonych izolatorach | ok | tak |
| utility_pole_04 | urban_ulica | 1.56×6.85×0.53 | 3980 | słup energetyczny | tak | TAK (114) | wszystkie słupy miasta; przewody zaczepione w zmierzonych izolatorach | ok | tak |
| utility_pole_05 | urban_ulica | 1.64×8.54×1.64 | 7050 | słup energetyczny | tak | TAK (42) | wszystkie słupy miasta; przewody zaczepione w zmierzonych izolatorach | ok | tak |
| vendingmachine_01 | urban_ulica | 1.21×2.04×0.72 | 970 | automat z napojami | tak | wczytany | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_02 | urban_ulica | 1.21×2.04×0.72 | 976 | automat z napojami | tak | TAK (23) | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_bottles_01 | urban_ulica | 1.21×2.04×0.72 | 2266 | automat z napojami | tak | TAK (45) | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_bottles_02 | urban_ulica | 1.21×2.04×0.72 | 1876 | automat z napojami | tak | TAK (22) | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_bottles_03 | urban_ulica | 1.21×2.04×0.72 | 2086 | automat z napojami | tak | TAK (22) | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_bottles_03_1 | urban_ulica | 1.21×2.04×0.72 | 2086 | automat z napojami | tak | nie | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| vendingmachine_bottles_04 | urban_ulica | 1.21×2.04×0.72 | 1750 | automat z napojami | tak | TAK (22) | stacja, konbini, uliczki, danchi; fronty świecą nocą | emisja nocą | tak |
| ventilation_01 | urban_ulica | 0.74×0.57×0.56 | 308 | wentylacja / czerpnia | tak | TAK (2) | dach i tył konbini; 02 — kandydat | ok | tak |
| ventilation_02 | urban_ulica | 0.93×0.84×0.42 | 168 | wentylacja / czerpnia | tak | nie | dach i tył konbini; 02 — kandydat | ok | tak |
| ventilation_03 | urban_ulica | 0.63×0.52×0.07 | 98 | wentylacja / czerpnia | tak | TAK (1) | dach i tył konbini; 02 — kandydat | ok | tak |
| wall_01 | ogrodzenia_i_mury | 2.75×1.81×0.32 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_01_1 | ogrodzenia_i_mury | 2.75×1.81×0.32 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_01_2 | ogrodzenia_i_mury | 2.75×1.81×0.32 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_01_3 | ogrodzenia_i_mury | 2.75×1.81×0.32 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_corner | ogrodzenia_i_mury | 1.07×1.84×1.08 | 360 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_corner_1 | ogrodzenia_i_mury | 1.07×1.84×1.08 | 360 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_corner_2 | ogrodzenia_i_mury | 1.07×1.84×1.08 | 360 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_corner_3 | ogrodzenia_i_mury | 1.07×1.84×1.08 | 360 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_fence | ogrodzenia_i_mury | 3.02×1.82×0.32 | 468 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_fence_1 | ogrodzenia_i_mury | 3.02×1.82×0.32 | 468 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_fence_2 | ogrodzenia_i_mury | 3.02×1.82×0.32 | 468 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_fence_3 | ogrodzenia_i_mury | 3.02×1.82×0.32 | 468 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_flowerbed | ogrodzenia_i_mury | 2.66×0.46×1.18 | 252 | mur / ogrodzenie / brama | częściowo | wczytany | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_flowerbed_1 | ogrodzenia_i_mury | 2.66×0.46×1.18 | 252 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_flowerbed_2 | ogrodzenia_i_mury | 2.66×0.46×1.18 | 252 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_flowerbed_3 | ogrodzenia_i_mury | 2.66×0.46×1.18 | 252 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_pillar | ogrodzenia_i_mury | 0.57×1.82×0.59 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_pillar_1 | ogrodzenia_i_mury | 0.57×1.82×0.59 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_pillar_2 | ogrodzenia_i_mury | 0.57×1.82×0.59 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| wall_pillar_3 | ogrodzenia_i_mury | 0.57×1.82×0.59 | 216 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_01 | ogrodzenia_i_mury | 11.35×1.88×14.46 | 7704 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_01_1 | ogrodzenia_i_mury | 11.35×1.88×14.46 | 7704 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_02 | ogrodzenia_i_mury | 8.00×1.88×7.43 | 3744 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_02_1 | ogrodzenia_i_mury | 8.00×1.88×7.43 | 3744 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_03 | ogrodzenia_i_mury | 8.00×1.88×4.74 | 3248 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| walls_poarch_05 | ogrodzenia_i_mury | 7.99×1.88×4.22 | 2448 | mur / ogrodzenie / brama | częściowo | nie | ogrodzenia działek są proceduralne i dopasowane do granic działek; kandydat do przyszłego osiedla | ok | tak |
| warning_panel_01 | znaki_i_szyldy | 0.41×0.41×0.01 | 12 | tabliczka informacyjna | tak | TAK (33) | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_02 | znaki_i_szyldy | 0.41×0.41×0.01 | 12 | tabliczka informacyjna | tak | TAK (1) | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_03 | znaki_i_szyldy | 0.71×0.47×0.01 | 44 | tabliczka informacyjna | tak | wczytany | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_04 | znaki_i_szyldy | 0.71×0.47×0.01 | 44 | tabliczka informacyjna | tak | TAK (15) | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_05 | znaki_i_szyldy | 0.71×0.47×0.01 | 44 | tabliczka informacyjna | tak | wczytany | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_06 | znaki_i_szyldy | 0.29×0.29×0.02 | 98 | tabliczka informacyjna | tak | wczytany | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_07 | znaki_i_szyldy | 0.29×0.29×0.02 | 98 | tabliczka informacyjna | tak | wczytany | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_08 | znaki_i_szyldy | 0.29×0.29×0.02 | 98 | tabliczka informacyjna | tak | TAK (1) | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
| warning_panel_09 | znaki_i_szyldy | 0.29×0.29×0.02 | 98 | tabliczka informacyjna | tak | wczytany | 01 punkty śmieci, 02 konbini, 04 駐車禁止 na żaluzjach, 08 szafa techniczna; reszta — kandydaci | ok | tak |
