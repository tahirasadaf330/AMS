-- Migration 005: Seed google_mo_estimates and google_mo_cost
-- Data sourced from SharePoint sheets: MO Traffic Estimates + Google Costs
-- Run this if you need to manually re-seed outside of the NestJS service boot.

-- Ensure estimation column is NUMERIC (not BIGINT)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_mo_estimates'
      AND column_name = 'estimation'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE google_mo_estimates ALTER COLUMN estimation TYPE NUMERIC(18,2);
  END IF;
END $$;

-- MO Traffic Estimates (country → conservative 2% estimate)
INSERT INTO google_mo_estimates (country, estimation) VALUES
('China',27071200.00),('India',21259800.00),('United States',3205065.20),
('Indonesia',5697954.00),('Russia',3629951.60),('Nigeria',3866715.00),
('Brazil',3534571.60),('Japan',1619654.40),('Pakistan',3392928.00),
('Bangladesh',3423762.00),('Philippines',2663264.00),('Iran',2651157.60),
('Vietnam',1786356.00),('Mexico',1943654.40),('Thailand',1693947.60),
('Germany',1357200.00),('Egypt',1841410.00),('South Africa',1664316.00),
('Turkey',1426708.40),('United Kingdom',897204.00),('Colombia',1244504.80),
('Italy',1083341.40),('Korea, South',1154880.00),('France',983129.60),
('Ethiopia',1299512.40),('Kenya',1183266.00),('Argentina',1072200.80),
('Tanzania',999187.20),('Spain',956124.00),('Burma',0.00),
('Morocco',900303.00),('Poland',904530.80),('Congo, Democratic Republic of the',847348.00),
('Ukraine',719838.40),('Algeria',911753.40),('Cote d''Ivoire',764493.60),
('Saudi Arabia',665132.40),('Malaysia',642556.80),('Iraq',733958.40),
('Peru',731262.40),('Ghana',648729.00),('Nepal',641978.40),
('Uzbekistan',613868.00),('Canada',287672.40),('Sudan',637946.40),
('Uganda',568769.60),('Sri Lanka',547896.98),('Taiwan',252000.00),
('Australia',246558.40),('Chile',417357.00),('Mali',465642.00),
('Kazakhstan',318767.40),('Burkina Faso',419526.00),('Angola',402830.40),
('Romania',338997.40),('Cameroon',388197.60),('Afghanistan',385526.00),
('Hong Kong',214237.80),('Senegal',316996.00),('Madagascar',353311.00),
('Netherlands',265433.60),('Guatemala',320626.80),('United Arab Emirates',332597.60),
('Zambia',337246.00),('Cambodia',230159.00),('Venezuela',326671.80),
('Ecuador',290350.60),('Syria',326227.20),('Tunisia',284283.80),
('Yemen',236776.80),('Benin',247350.00),('Zimbabwe',243117.00),
('Niger',247758.60),('Libya',223040.00),('Mozambique',255226.40),
('Guinea',234515.00),('Israel',200866.80),('Czechia',204820.00),
('Sweden',158328.00),('Portugal',181646.40),('Malawi',228203.40),
('Chad',195809.40),('Bolivia',221425.60),('Belgium',130614.00),
('Belarus',153023.00),('Tajikistan',180710.40),('El Salvador',195653.00),
('Greece',185746.40),('Azerbaijan',170447.20),('Austria',136834.00),
('Rwanda',184833.60),('Switzerland',106590.00),('Hungary',176324.00),
('Dominican Republic',131950.00),('Singapore',279189.00),('Paraguay',147203.00),
('Serbia',136211.80),('Kyrgyzstan',136176.00),('Sierra Leone',143149.80),
('Bulgaria',130609.60),('Honduras',130166.80),('Costa Rica',118140.00),
('Kuwait',92712.00),('Jordan',125066.40),('Cuba',118560.00),
('Burundi',135972.20),('Slovakia',116142.00),('Denmark',75928.80),
('Haiti',124423.00),('Finland',108376.00),('Panama',117147.00),
('Oman',97200.00),('Nicaragua',117075.20),('Togo',108962.40),
('Turkmenistan',100080.00),('Norway',26466.00),('Korea, North',91200.00),
('New Zealand',76121.60),('Georgia',93504.00),('Ireland',73970.00),
('Congo, Republic of the',96016.00),('Mauritania',91086.00),('Mongolia',77376.00),
('Laos',86814.00),('Papua New Guinea',81906.00),('Uruguay',80597.00),
('Qatar',70395.00),('Croatia',62720.00),('West Bank',70208.00),
('Gaza Strip',74596.00),('Botswana',73916.00),('Lebanon',47168.00),
('Moldova',58380.00),('Puerto Rico',42856.00),('Lithuania',53564.00),
('Bosnia and Herzegovina',60992.00),('Armenia',60176.00),('South Sudan',55692.00),
('Jamaica',51051.00),('Gabon',50915.00),('Namibia',49402.00),
('Albania',44512.00),('Gambia, The',45526.00),('Slovenia',37450.00),
('Guinea-Bissau',45084.00),('Latvia',30338.00),('Bahrain',32115.00),
('Mauritius',35649.00),('Estonia',28784.00),('North Macedonia',32768.00),
('Trinidad and Tobago',33983.00),('Central African Republic',31127.00),
('Eritrea',30617.00),('Kosovo',28445.74),('Liberia',28101.00),
('Lesotho',26469.00),('Timor-Leste',26658.00),('Eswatini',24956.00),
('Cyprus',16704.00),('Montenegro',20384.00),('Macau',13343.00),
('Fiji',16864.00),('Suriname',15793.00),('Equatorial Guinea',15181.00),
('Luxembourg',10512.00),('Guyana',14552.00),('Comoros',14263.00),
('Bhutan',13356.00),('Maldives',12155.00),('Malta',8424.00),
('Cabo Verde',10013.00),('Brunei',7935.00),('Djibouti',8823.00),
('Solomon Islands',8058.00),('Iceland',5484.00),('Bahamas, The',4444.00),
('French Polynesia',3608.00),('Barbados',3553.00),('Belize',4488.00),
('New Caledonia',2860.00),('Vanuatu',4352.00),('Seychelles',3485.00),
('Sao Tome and Principe',3349.00),('Antigua and Barbuda',2024.00),
('Saint Lucia',1892.00),('Curacao',1848.00),('Aruba',1551.00),
('Samoa',2278.00),('Jersey',1364.91),('Andorra',1368.00),
('Saint Vincent and the Grenadines',1144.00),('Grenada',1111.00),
('Cayman Islands',1100.00),('Guam',1078.00),('Virgin Islands',880.00),
('Guernsey',786.34),('Saint Martin',757.24),('Sint Maarten',757.24),
('Bermuda',748.00),('Greenland',737.00),('Kiribati',1088.00),
('Tonga',1088.00),('Dominica',682.00),('Faroe Islands',708.00),
('Saint Kitts and Nevis',627.00),('Liechtenstein',600.00),('San Marino',492.00),
('Monaco',468.00),('British Virgin Islands',418.00),('Gibraltar',444.00),
('Anguilla',286.00),('Turks and Caicos Islands',275.94),('Palau',408.00),
('Micronesia, Federated States of',374.00),('Northern Mariana Islands',225.21),
('Cook Islands',289.00),('Marshall Islands',272.00),('Nauru',170.00),
('Tuvalu',153.00),('Falkland Islands (Islas Malvinas)',66.00),
('Montserrat',55.00),('Saint Helena, Ascension, and Tristan da Cunha',44.00),
('American Samoa',38.25),('Wallis and Futuna',0.00)
ON CONFLICT (country) DO NOTHING;

-- Google Costs (aggregated per country/month — Jan-Jun 2026)
-- Ghana: Tigo(45.55) + MTN(0) + Vodafone(396.39) = 441.94; misc 166.67×3 = 500.00
-- Malawi: TNM(79.80) + Airtel(67.32) = 147.12
-- Kenya: Airtel + Safaricom + Telkom = 165.86×3 = 497.58
-- Senegal: Orange + Free + Expresso = 114.06×3 = 342.18
-- Libya: Aljeel + Almadar + Libyana = 66.66×3 = 199.98
-- Syria: April 200 (MTN 100 + Syriatel 100); May-Jun 100 (50+50)
-- Mali: May-Jun Malitel + Orange + Telecel = 116.6666×3 ≈ 350.00
INSERT INTO google_mo_cost (country, year, month, monthly_cost, miscellaneous) VALUES
('Ghana',  2026, 1, 441.94, 500.00),
('Ghana',  2026, 2, 441.94, 500.00),
('Ghana',  2026, 3, 441.94, 500.00),
('Ghana',  2026, 4, 441.94, 500.00),
('Ghana',  2026, 5, 441.94, 500.00),
('Ghana',  2026, 6, 441.94, 500.00),
('Malawi', 2026, 1, 147.12, 0.00),
('Malawi', 2026, 2, 147.12, 0.00),
('Malawi', 2026, 3, 147.12, 0.00),
('Malawi', 2026, 4, 147.12, 0.00),
('Malawi', 2026, 5, 147.12, 0.00),
('Malawi', 2026, 6, 147.12, 0.00),
('Kenya',  2026, 1, 497.58, 0.00),
('Kenya',  2026, 2, 497.58, 0.00),
('Kenya',  2026, 3, 497.58, 0.00),
('Kenya',  2026, 4, 497.58, 0.00),
('Kenya',  2026, 5, 497.58, 0.00),
('Kenya',  2026, 6, 497.58, 0.00),
('Senegal',2026, 1, 342.18, 0.00),
('Senegal',2026, 2, 342.18, 0.00),
('Senegal',2026, 3, 342.18, 0.00),
('Senegal',2026, 4, 342.18, 0.00),
('Senegal',2026, 5, 342.18, 0.00),
('Senegal',2026, 6, 342.18, 0.00),
('Libya',  2026, 1, 199.98, 0.00),
('Libya',  2026, 2, 199.98, 0.00),
('Libya',  2026, 3, 199.98, 0.00),
('Libya',  2026, 4, 199.98, 0.00),
('Libya',  2026, 5, 199.98, 0.00),
('Libya',  2026, 6, 199.98, 0.00),
('Syria',  2026, 4, 200.00, 0.00),
('Syria',  2026, 5, 100.00, 0.00),
('Syria',  2026, 6, 100.00, 0.00),
('Mali',   2026, 5, 350.00, 0.00),
('Mali',   2026, 6, 350.00, 0.00)
ON CONFLICT ON CONSTRAINT google_mo_cost_ym_country DO NOTHING;
