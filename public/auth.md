# 認証について（FursuitWeather）

FursuitWeather（着ぐるみ天気予報）には、ログインや認証の仕組みはありません。

- 利用者アカウントはなく、登録・ログイン・ログアウトの画面もありません
- 公開API（`/api/*`）は認証なしで利用できます。APIキー・アクセストークン・OAuthなどは不要で、受け付けてもいません
- APIはGETのみで、CORSに対応しています（ほかのサイトやアプリから直接呼び出せます）
- お気に入り地点などの設定は、利用者のブラウザ内（localStorage）にだけ保存します。サーバー側に利用者ごとのデータはありません
- アクセス解析には、Cookieを使わないCloudflare Web Analyticsを利用しています

## 利用時のお願い

気象データは提供元（Open-Meteo）の無料枠を利用しています。
大量アクセスや短い間隔での繰り返し取得はお控えください。

## 関連情報

- APIの一覧（RFC 9727のAPIカタログ）: [/.well-known/api-catalog](https://fursuit-weather.223n.tech/.well-known/api-catalog)
- API仕様: [docs/api.md](https://github.com/223n/FursuitWeather/blob/main/docs/api.md)
- サービスの概要（AI向け）: [/llms.txt](https://fursuit-weather.223n.tech/llms.txt)
