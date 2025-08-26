import {Service} from "./service.js"

export class Spotify extends Service {
    client_id = "d45c460b9f56492ea9c297993d7efdb7"
    authorization_endpoint = "https://accounts.spotify.com/authorize"
    exchange_endpoint = "https://accounts.spotify.com/api/token"
    scope = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read user-library-modify"
}
