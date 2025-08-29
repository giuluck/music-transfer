import {Service} from "./service.js"

export class Spotify extends Service {
    clientID = "d45c460b9f56492ea9c297993d7efdb7"
    authorizationEndpoint = "https://accounts.spotify.com/authorize"
    exchangeEndpoint = "https://accounts.spotify.com/api/token"
    scope = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read user-library-modify"

    constructor(update) {
        super(update, "Spotify")
    }
}
