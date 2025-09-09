import {Albums, All, Artists, Playlist, Tracks} from "./groups.js"
import {Service} from "./service.js"


export class Spotify extends Service {
    constructor(apply) {
        super(apply, "Spotify", undefined, {
            clientID: "d45c460b9f56492ea9c297993d7efdb7",
            authorizationEndpoint: "https://accounts.spotify.com/authorize",
            exchangeEndpoint: "https://accounts.spotify.com/api/token",
            scope: "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-follow-read user-follow-modify user-library-read user-library-modify"
        })
    }

    _fetch() {
        // build an empty jQuery promise to be consistent with the return type
        return $.when().then(_ => {
            // build the routine to fetch favourite artists
            const artistsRoutine = this._fetchRoutine({
                url: "https://api.spotify.com/v1/me/following?type=artist&limit=50",
                routine: res => {
                    const items = res.artists.items
                        .filter(artist => artist && artist.id)
                        .map(artist => new Object({
                            spotify: artist.id,
                            name: artist.name
                        }))
                    return {url: res.artists.next, items: items}
                }
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this._fetchRoutine({
                url: "https://api.spotify.com/v1/me/albums?limit=50",
                routine: res => {
                    const items = res.items
                        .map(album => album.album)
                        .filter(album => album && album.id)
                        .map(album => new Object({
                            spotify: album.id,
                            name: album.name,
                            artists: album.artists.map(artist => artist.name),
                            upc: album.external_ids.upc
                        }))
                    return {url: res.next, items: items}
                }
            })
            // build the routine to fetch favourite tracks
            const tracksRoutine = this._fetchRoutine({
                url: "https://api.spotify.com/v1/me/tracks?limit=50",
                routine: res => {
                    const items = res.items
                        .map(track => track.track)
                        .filter(track => track && track.id)
                        .map(track => new Object({
                            spotify: track.id,
                            name: track.name,
                            artists: track.artists.map(artist => artist.name),
                            isrc: track.external_ids.isrc
                        }))
                    return {url: res.next, items: items}
                }
            })
            //build the items routine to fetch playlist items given the playlist id
            const itemsRoutine = playlist => this._fetchRoutine({
                url: "https://api.spotify.com/v1/playlists/" + playlist.id + "/tracks?limit=100",
                routine: res => {
                    const items = res.items
                        .map(item => item.track)
                        .filter(item => item && item.id)
                        .map(item => new Object({
                            spotify: item.uri,
                            name: item.name,
                            artists: item.artists.map(artist => artist.name),
                            isrc: item.external_ids.isrc
                        }))
                    return {url: res.next, items: items}
                }
            })
            // build the routine to fetch playlists information (using internally the routine to fetch its items)
            const playlistsRoutine = this._fetchRoutine({
                url: "https://api.spotify.com/v1/me/playlists?limit=50",
                routine: res => {
                    const items = res.items.filter(playlist => playlist).map(playlist => new Playlist(
                        itemsRoutine(playlist), {
                            name: playlist.name,
                            description: playlist.description,
                            open: playlist.public
                        }))
                    return {url: res.next, items: items}
                }
            })
            // build the "All" object with already built items and the routine to fetch all the playlists
            return new All([
                new Artists(artistsRoutine),
                new Albums(albumsRoutine),
                new Tracks(tracksRoutine)
            ], playlistsRoutine)
        })
    }

    _transfer(transfer) {
        // start by getting user information
        this._request("https://api.spotify.com/v1/me").then(user => {
            let process
            let query
            let push
            // assign the variables depending on the datatype
            switch (transfer.data.type) {
                case "artists":
                    // query as many artists as possible using the name
                    // then filter for those whose name is exactly the one we look for and return the first result
                    process = (res, artist) => res.artists.items
                        .filter(it => it.name.toLowerCase() === artist.name.toLowerCase())
                        .map(it => it.id)
                    query = artist => "https://api.spotify.com/v1/search?limit=50&type=artist&q=artist:" + artist.name
                    push = "https://api.spotify.com/v1/me/following?type=artist"
                    break
                case "albums":
                    process = res => res.albums.items.map(it => it.id)
                    query = album => "https://api.spotify.com/v1/search?limit=1&type=album&q=upc:" + album.upc
                    push = "https://api.spotify.com/v1/me/albums"
                    break
                case "tracks":
                    process = res => res.tracks.items.map(it => it.id)
                    query = track => "https://api.spotify.com/v1/search?limit=1&type=track&q=isrc:" + track.isrc
                    push = "https://api.spotify.com/v1/me/tracks"
                    break
                case "playlist":
                    // use a different strategy for playlists, i.e.:
                    //   > first post a request to build the playlist using the user id and the playlist data
                    //   > then call the _transferRoutine routine to post tracks on the newly created playlist
                    this._request("https://api.spotify.com/v1/users/" + user.id + "/playlists", {
                        method: "POST",
                        message: "Error during playlist creation",
                        name: transfer.data.name,
                        description: transfer.data.description,
                        public: transfer.data.open
                    }).then(playlist => this._transferRoutine({
                            process: res => res.tracks.items.map(it => it.uri),
                            query: item => "https://api.spotify.com/v1/search?limit=1&type=track&q=isrc:" + item.isrc,
                            push: batch => new Object({
                                url: "https://api.spotify.com/v1/playlists/" + playlist.id + "/tracks",
                                method: "POST",
                                uris: batch
                            }),
                            limit: 50,
                            transfer: transfer
                        })
                    ).catch(() => transfer.abort())
                    return
                default:
                    console.warn("Unexpected group type " + transfer.data.type)
                    transfer.abort()
                    return
            }
            // call the _transferRoutine routine setting the routine with the given variables
            this._transferRoutine({
                process: process,
                query: query,
                push: batch => new Object({url: push, method: "PUT", ids: batch}),
                limit: 50,
                transfer: transfer
            })
        }).catch(() => transfer.abort())
    }
}