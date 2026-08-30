# 参考資料・出典

判定式・しきい値・データの出典と、設計の参考にした資料の一覧です。
コード上の使用箇所は`src/constants/`の出典コメントも参照してください。

## 気象データ

- [Weather data by Open-Meteo.com](https://open-meteo.com/)
  （CC BY 4.0、気象庁MSM/GSMモデル由来、非商用利用）
  - 表示時は出典の明記が必要です（APIレスポンスの`attribution`参照）
  - 無料枠は1日1万コール。エッジキャッシュで消費を抑えています

## WBGT（暑さ指数）

- [環境省 熱中症予防情報サイト](https://www.wbgt.env.go.jp/)
  - 推定式（小野ら2014）と5段階のしきい値（21/25/28/31℃）
  - [観測・推定方法の解説](https://www.wbgt.env.go.jp/doc_observation.php)
- [小野ら（2014）「実況値と数値予報値を用いたWBGT予測」](https://www.jstage.jst.go.jp/article/seikisho/50/4/50_147/_pdf)
- [日本スポーツ協会 熱中症予防運動指針](https://www.japan-sports.or.jp/medicine/tabid/922/Default.aspx)

## 着衣補正値

- [厚生労働省「職場における熱中症予防基本対策要綱」](https://www.jaish.gr.jp/horei/hor1-56/hor1-56-12-1-3.pdf)
  （ISO 7243:2017準拠）
  - 「フード付き蒸気不透過つなぎ服」= +11℃を着ぐるみに適用

## 屋内WBGTの想定風速

- [日本生気象学会「日常生活における熱中症予防指針」](https://seikishou.jp/cms/wp-content/uploads/20220523-v4.pdf)
  - 室内用WBGT簡易推定図が想定する室内風速（0.5m/s）

## 連続活動時間の目安

- [さいたま市「着ぐるみ使用マニュアル」（PDF）](https://www.city.saitama.lg.jp/006/012/001/004/004/p010212_d/fil/kigurumi-m.pdf)
- [三原市「公式マスコットキャラクター使用に関するマニュアル」（PDF）](https://www.city.mihara.hiroshima.jp/uploaded/life/150268_522697_misc.pdf)
- [Anthrocon「Fursuiting in the Summer」](https://www.anthrocon.org/guides/fursuiting-in-the-summer/)
- [Melbourne Fur Con「Fursuiting Guidelines」](https://melbfurcon.com/fursuiting-guidelines/)

## 洗濯乾燥指数

- [Tetensの式（Wikipedia）](https://en.wikipedia.org/wiki/Tetens_equation)
  - 飽和水蒸気圧の近似式
- [tenki.jp 洗濯指数](https://tenki.jp/indexes/cloth_dried/)
  - 5段階の段階分けの互換基準
- 風速関数はMeyer式（小さい濡れ面の蒸発量推定）のm/s換算形

## 地点検索

- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
  - 都市名から座標を検索（GeoNamesデータ由来）
- [zipcloud 郵便番号検索API](https://zipcloud.ibsnet.co.jp/doc/api)
  - 日本の郵便番号から住所（市区町村名）への変換に使用

## デザイン・アイコン

- カラーユニバーサルデザイン（CUD）推奨色をベースにした配色
- [Font Awesome Free](https://fontawesome.com/)（CC BY 4.0）
  - SVGを自前配信（詳細は[アクセシビリティ設計](accessibility.md)）

## ソースコード

- [GitHub: 223n/FursuitWeather](https://github.com/223n/FursuitWeather)
  （Apache License 2.0）
