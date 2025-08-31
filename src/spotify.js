import {SourceService, TargetService} from "./service.js"

const data = {
    name: "Spotify",
    title: "Spotify",
    // token: {
    //     clientID: "d45c460b9f56492ea9c297993d7efdb7",
    //     authorizationEndpoint: "https://accounts.spotify.com/authorize",
    //     exchangeEndpoint: "https://accounts.spotify.com/api/token",
    //     scope: "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read user-library-modify"
    // }
    token: () => true
}

function fetch({done, fail, apply}) {
}

function transfer({transfer, apply}) {
}

export const sourceSpotify = new SourceService({fetch: fetch, ...data})

export const targetSpotify = new TargetService({transfer: transfer, ...data})