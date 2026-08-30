// FursuitWeather 定数定義（公開窓口）
// 係数・しきい値はすべてこのディレクトリに集約し、出典を明記する。
// 利用側は関心事に関係なく`../constants`から取得できるよう、ここで全てを再exportする
// （分割は保守のためで、単一情報源であることは変えない）。
//
// | ファイル | 担当 |
// |---|---|
// | activity.ts | 活動判定（WBGT推定式・着衣補正・暑熱／低温の帯・冷房要否・通年の注意） |
// | laundry.ts | 洗濯乾燥指数 |
// | staticElectricity.ts | 静電気指数 |
// | airQuality.ts | 空気のよごれ指数 |
// | weather.ts | 気象そのものの注意基準と時間帯 |
// | upstream.ts | 上流APIのURL・キャッシュ・応答表記 |
// | geo.ts | 全国主要都市・都道府県代表点 |
// | badge.ts | 埋め込みバッジの記号と配色 |

export * from './activity';
export * from './airQuality';
export * from './badge';
export * from './geo';
export * from './laundry';
export * from './staticElectricity';
export * from './upstream';
export * from './weather';
