import {Albums, All, Artists, Playlist, Tracks} from "./groups.js"
import {SourceService, TargetService} from "./service.js"

const data = {
    name: "Spotify",
    title: "Spotify",
    token: {
        clientID: "d45c460b9f56492ea9c297993d7efdb7",
        authorizationEndpoint: "https://accounts.spotify.com/authorize",
        exchangeEndpoint: "https://accounts.spotify.com/api/token",
        scope: "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-follow-read user-follow-modify user-library-read user-library-modify"
    }
}

// custom spotify request
function request(url, token, {
    method = "GET",
    ...data
} = {}) {
    return $.ajax({
        url: url,
        method: method,
        headers: {Authorization: "Bearer " + token},
        data: $.isEmptyObject(data) ? undefined : JSON.stringify(data)
    })
}

function check({done, fail, apply}) {
    request("https://api.spotify.com/v1/me", this.token).done(done).fail(fail).always(apply)
}

function fetch({done, fail, apply}) {
    // start with a safety check by calling the spotify api to get user information
    this.check({
        apply: apply,
        fail: fail,
        done: _ => {
            // build the routine to fetch favourite artists
            const artistsRoutine = this.fetchRoutine({
                url: "https://api.spotify.com/v1/me/following?type=artist&limit=50",
                routine: res => {
                    const items = res.artists.items.filter(artist => artist).map(artist => new Object({name: artist.name}))
                    return {url: res.artists.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this.fetchRoutine({
                url: "https://api.spotify.com/v1/me/albums?limit=50",
                routine: res => {
                    const items = res.items.map(album => album.album).filter(album => album).map(album => new Object({
                        name: album.name,
                        artists: album.artists.map(artist => artist.name),
                        upc: album.external_ids.upc
                    }))
                    return {url: res.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite tracks
            const tracksRoutine = this.fetchRoutine({
                url: "https://api.spotify.com/v1/me/tracks?limit=50",
                routine: res => {
                    const items = res.items.map(track => track.track).filter(track => track).map(track => new Object({
                        name: track.name,
                        artists: track.artists.map(artist => artist.name),
                        isrc: track.external_ids.isrc
                    }))
                    return {url: res.next, items: items}
                },
                request: request,
                apply: apply
            })
            //build the items routine to fetch playlist items given the playlist id
            const itemsRoutine = playlist => this.fetchRoutine({
                url: "https://api.spotify.com/v1/playlists/" + playlist.id + "/tracks?limit=100",
                routine: res => {
                    const items = res.items.map(item => item.track).filter(item => item).map(item => new Object({
                        name: item.name,
                        artists: item.artists.map(artist => artist.name),
                        isrc: item.external_ids.isrc
                    }))
                    return {url: res.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch playlists information (using internally the routine to fetch its items)
            const playlistsRoutine = this.fetchRoutine({
                url: "https://api.spotify.com/v1/me/playlists?limit=50",
                routine: res => {
                    const items = res.items.filter(playlist => playlist).map(playlist => new Playlist(
                        itemsRoutine(playlist), {
                            name: playlist.name,
                            description: playlist.description,
                            open: playlist.public
                        }))
                    return {url: res.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the "All" object with already built items and the routine to fetch all the playlists
            const all = new All([
                new Artists(artistsRoutine),
                new Albums(albumsRoutine),
                new Tracks(tracksRoutine)
            ], playlistsRoutine)
            // rune the "done" routine
            done(all)
        }
    })
}

function transfer({transfer, apply}) {
    // start with a safety check by calling the spotify api to get user information
    this.check({
        apply: apply,
        fail: () => transfer.abort(),
        done: user => {
            let query
            let push
            // assign the variables depending on the datatype
            switch (transfer.data.type) {
                case "artists":
                    // query as many artists as possible using the name
                    // then filter for those whose name is exactly the one we look for and return the first result
                    query = artist => request(
                        "https://api.spotify.com/v1/search?limit=50&type=artist&q=artist:" + artist.name,
                        this.token
                    ).then(res => res.artists.items.filter(it => it.name.toLowerCase() === artist.name.toLowerCase()).map(it => it.id).slice(0, 1))
                    push = data => request(
                        "https://api.spotify.com/v1/me/following?type=artist",
                        this.token,
                        {method: "PUT", ids: data.map(it => it.data)}
                    )
                    break
                case "albums":
                    query = album => request(
                        "https://api.spotify.com/v1/search?limit=1&type=album&q=upc:" + album.upc,
                        this.token
                    ).then(res => res.albums.items.map(it => it.id))
                    push = data => request(
                        "https://api.spotify.com/v1/me/albums",
                        this.token,
                        {method: "PUT", ids: data.map(it => it.data)}
                    )
                    break
                case "tracks":
                    query = track => request(
                        "https://api.spotify.com/v1/search?limit=1&type=track&q=isrc:" + track.isrc,
                        this.token
                    ).then(res => res.tracks.items.map(it => it.id))
                    push = data => request(
                        "https://api.spotify.com/v1/me/tracks",
                        this.token,
                        {method: "PUT", ids: data.map(it => it.data)}
                    )
                    break
                case "playlist":
                    // use a different strategy for playlists, i.e.:
                    //   > first post a request to build the playlist using the user id and the playlist data
                    //   > then call the transferRoutine routine to post tracks on the newly created playlist
                    request(
                        "https://api.spotify.com/v1/users/" + user.id + "/playlists",
                        this.token, {
                            method: "POST",
                            name: transfer.data.name,
                            description: transfer.data.description,
                            public: transfer.data.open
                        }
                    ).done(playlist => this.transferRoutine({
                            query: item => request(
                                "https://api.spotify.com/v1/search?limit=1&type=track&q=isrc:" + item.isrc,
                                this.token
                            ).then(res => res.tracks.items.map(it => it.uri)),
                            push: data => request(
                                "https://api.spotify.com/v1/playlists/" + playlist.id + "/tracks",
                                this.token,
                                {method: "POST", uris: data.map(it => it.data)}
                            ),
                            limit: 50,
                            transfer: transfer,
                            apply: apply
                        })
                    ).fail(res => {
                        // in case of failure, wait between 0 and 10 seconds before trying again
                        const time = Math.floor(10000 * Math.random())
                        console.warn("Error during playlist creation, waiting " + time + "ms before trying again", res)
                        new Promise(handler => setTimeout(handler, time))
                            .then(() => this.transfer({transfer: transfer, apply: apply}))
                            .catch(_ => void 0)
                    })
                    return
                default:
                    console.warn("Unexpected group type " + transfer.data.type)
                    transfer.abort()
                    return
            }
            // call the transferRoutine routine setting the routine with the given variables
            this.transferRoutine({
                query: query,
                push: push,
                limit: 50,
                transfer: transfer,
                apply: apply
            })
        }
    })
}

export const sourceSpotify = new SourceService({fetch: fetch, check: check, ...data})

export const targetSpotify = new TargetService({transfer: transfer, check: check, ...data})