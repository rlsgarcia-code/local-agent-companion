export type Point = { x: number; y: number };
export type Bumper = Point & { r: number };
export type Table = { id: string; name: string; chapter: string; hint: string; shots: number; wind: number; lamps: Point[]; bumpers: Bumper[] };
const points = (rows: number[][]): Point[] => rows.map(([x, y]) => ({ x: x!, y: y! }));
const pins = (rows: number[][]): Bumper[] => rows.map(([x, y, r]) => ({ x: x!, y: y!, r: r ?? 30 }));
export const TABLES: Table[] = [
 { id: 'first', name: 'Um pequeno arco', chapter: 'I · Acender', hint: 'Acerte as três lanternas. A bolinha rebate nas bordas.', shots: 4, wind: 0, lamps: points([[230,210],[320,130],[410,210]]), bumpers: [] },
 { id: 'echo', name: 'O outro lado', chapter: 'I · Acender', hint: 'Uma boa tabela acende mais de uma lanterna.', shots: 5, wind: 0, lamps: points([[160,170],[480,170],[220,360],[420,360]]), bumpers: pins([[320,280,36]]) },
 { id: 'petals', name: 'Quatro pétalas', chapter: 'I · Acender', hint: 'Os discos azuis devolvem impulso à bolinha.', shots: 5, wind: 0, lamps: points([[155,210],[485,210],[200,430],[440,430]]), bumpers: pins([[320,210],[260,350],[380,350]]) },
 { id: 'bridge', name: 'Entre as pontes', chapter: 'I · Acender', hint: 'Procure o espaço entre os discos.', shots: 6, wind: 0, lamps: points([[110,150],[320,150],[530,150],[175,390],[465,390]]), bumpers: pins([[230,275],[410,275],[320,440]]) },
 { id: 'orbit', name: 'Órbita de bolso', chapter: 'II · Ressoar', hint: 'A tangente de um disco muda completamente a viagem.', shots: 6, wind: 0, lamps: points([[150,140],[490,140],[100,320],[540,320],[245,430],[395,430]]), bumpers: pins([[320,260,58],[160,460],[480,460]]) },
 { id: 'garden', name: 'Jardim de cerâmica', chapter: 'II · Ressoar', hint: 'Passagens estreitas, caminhos grandes.', shots: 6, wind: 0, lamps: points([[130,150],[320,125],[510,150],[110,390],[320,390],[530,390]]), bumpers: pins([[220,245,33],[420,245,33],[220,440,33],[420,440,33]]) },
 { id: 'stairs', name: 'Escada de ecos', chapter: 'II · Ressoar', hint: 'Use as bordas para chegar por trás.', shots: 6, wind: 0, lamps: points([[130,155],[265,190],[400,225],[520,330],[390,395],[180,440]]), bumpers: pins([[190,280],[325,320],[460,280]]) },
 { id: 'moon', name: 'A lua no meio', chapter: 'II · Ressoar', hint: 'Você tem seis lançamentos; cada combo deixa uma assinatura.', shots: 6, wind: 0, lamps: points([[150,160],[320,130],[490,160],[110,330],[530,330],[220,465],[420,465]]), bumpers: pins([[320,300,68],[125,500,24],[515,500,24]]) },
 { id: 'breeze', name: 'Brisa de papel', chapter: 'III · Flutuar', hint: 'A brisa puxa para a direita. A previsão da mira já sente o vento.', shots: 6, wind: 36, lamps: points([[125,160],[310,150],[500,180],[160,370],[360,420],[530,390]]), bumpers: pins([[230,270,38],[450,295,38]]) },
 { id: 'return', name: 'Vento de volta', chapter: 'III · Flutuar', hint: 'Agora a brisa vem do outro lado.', shots: 6, wind: -42, lamps: points([[135,150],[320,125],[505,150],[110,365],[530,365],[240,470],[400,470]]), bumpers: pins([[220,265,38],[420,265,38],[320,400,34]]) },
 { id: 'constellation', name: 'Uma constelação', chapter: 'III · Flutuar', hint: 'Rebater não custa outro lançamento. Faça os discos trabalharem.', shots: 6, wind: 25, lamps: points([[120,150],[320,120],[520,150],[100,310],[540,310],[180,460],[460,460]]), bumpers: pins([[220,240,35],[420,240,35],[320,355,48],[120,520,23],[520,520,23]]) },
 { id: 'workshop', name: 'A oficina acesa', chapter: 'III · Flutuar', hint: 'A última mesa reúne tudo: mira, tabelas, discos e brisa.', shots: 7, wind: -28, lamps: points([[120,145],[255,135],[385,135],[520,145],[105,360],[535,360],[230,460],[410,460]]), bumpers: pins([[180,250,35],[320,275,43],[460,250,35],[320,465,33]]) },
];
