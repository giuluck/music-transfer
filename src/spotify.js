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
            const artistsRoutine = this.fetchRecursive({
                url: "https://api.spotify.com/v1/me/following?type=artist&limit=50",
                routine: res => {
                    const items = res.artists.items.filter(artist => artist).map(artist => new Object({name: artist.name}))
                    return {url: res.artists.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this.fetchRecursive({
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
            const tracksRoutine = this.fetchRecursive({
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
            const itemsRoutine = playlist => this.fetchRecursive({
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
            const playlistsRoutine = this.fetchRecursive({
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
        done: _ => {
            // spotify does not allow to query multiple items, hence it is not possible to group several items together
            const item = transfer.items[transfer.transferred]
            switch (transfer.data.type) {
                case "artists":
                    break
                case "albums":
                    this.transferRecursive({
                        requests: (token, done, fail) =>
                            request("https://api.spotify.com/v1/search?type=album&limit=1&q=upc:" + item.data.upc, token)
                                .then(res => {
                                    const ids = res.albums.items.map(album => album.id)
                                    if (ids.length === 0) {
                                        transfer.missing.push(item)
                                        done(1)
                                    } else {
                                        request(
                                            "https://api.spotify.com/v1/me/albums",
                                            token,
                                            {method: "PUT", ids: ids}
                                        ).done(_ => done(1)).fail(fail)
                                    }
                                }),
                        transfer: transfer,
                        apply: apply
                    })
                    break
                case "tracks":
                    this.transferRecursive({
                        requests: (token, done, fail) =>
                            request("https://api.spotify.com/v1/search?type=track&limit=1&q=isrc:" + item.data.isrc, token)
                                .then(res => {
                                    const ids = res.tracks.items.map(track => track.id)
                                    if (ids.length === 0) {
                                        transfer.missing.push(item)
                                        done(1)
                                    } else {
                                        request(
                                            "https://api.spotify.com/v1/me/tracks",
                                            token,
                                            {method: "PUT", ids: ids}
                                        ).done(_ => done(1)).fail(fail)
                                    }
                                }),
                        transfer: transfer,
                        apply: apply
                    })
                    break
                case "playlists":
                    break
            }
        }
    })
}

export const sourceSpotify = new SourceService({fetch: fetch, check: check, ...data})

export const targetSpotify = new TargetService({transfer: transfer, check: check, ...data})