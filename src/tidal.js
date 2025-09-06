import {Albums, All, Artists, Playlist, Tracks} from "./groups.js"
import {SourceService, TargetService} from "./service.js"

const data = {
    name: "Tidal",
    title: "Tidal",
    token: {
        clientID: "CE49NT7wvkwoZ1s3",
        authorizationEndpoint: "https://login.tidal.com/authorize",
        exchangeEndpoint: "https://auth.tidal.com/v1/oauth2/token",
        scope: "collection.read collection.write playlists.read playlists.write user.read"
    }
}

// custom tidal request
function request(url, token, {
    method = "GET",
    accept = "application/vnd.api+json",
    contentType = "application/x-www-form-urlencoded; charset=UTF-8",
    ...data
} = {}) {
    return $.ajax({
        url: `https://openapi.tidal.com/v2/${url}`,
        method: method,
        contentType: contentType,
        headers: {accept: accept, Authorization: "Bearer " + token},
        data: $.isEmptyObject(data) ? undefined : JSON.stringify(data)
    })
}

function check({done, fail, apply}) {
    // safety check call to user/me
    request("users/me", this.token).done(done).fail(fail).always(apply)
}

function fetch({done, fail, apply}) {
    // get user information and use them to build the various query links
    this.check({
        apply: apply,
        fail: fail,
        done: res => {
            const user = {id: res.data.id, country: res.data.attributes.country, locale: navigator.language}
            // build the routine to fetch favourite artists
            const artistsRoutine = this.fetchRecursive({
                url: "userCollections/" + user.id + "/relationships/artists?countryCode=" + user.country + "&locale=" + user.locale + "&include=artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(artist => info[artist.id]).filter(artist => artist).map(artist => new Object({name: artist.attributes.name}))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this.fetchRecursive({
                url: "userCollections/" + user.id + "/relationships/albums?countryCode=" + user.country + "&locale=" + user.locale + "&include=albums.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(album => info[album.id]).filter(album => album).map(album => new Object({
                        name: album.attributes.title,
                        artists: album.relationships.artists.data.map(artist => info[artist.id].attributes.name),
                        upc: album.attributes.barcodeId
                    }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite tracks
            const tracksRoutine = this.fetchRecursive({
                url: "userCollections/" + user.id + "/relationships/tracks?countryCode=" + user.country + "&locale=" + user.locale + "&include=tracks.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(track => info[track.id]).filter(track => track).map(track => new Object({
                        name: track.attributes.title,
                        artists: track.relationships.artists.data.map(artist => info[artist.id].attributes.name),
                        isrc: track.attributes.isrc
                    }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            //build the items routine to fetch playlist items given the playlist id
            const itemsRoutine = playlist => this.fetchRecursive({
                url: "/playlists/" + playlist.id + "/relationships/items?countryCode=" + user.country + "&include=items.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(item => info[item.id]).filter(item => item).map(item => new Object({
                        name: item.attributes.title,
                        artists: item.relationships.artists.data.map(artist => info[artist.id].attributes.name),
                        isrc: item.attributes.isrc
                    }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch playlists information (using internally the routine to fetch its items)
            const playlistsRoutine = this.fetchRecursive({
                url: "userCollections/" + user.id + "/relationships/playlists?countryCode=" + user.country + "&locale=" + user.locale + "&include=playlists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(playlist => info[playlist.id]).filter(playlist => playlist).map(playlist => new Playlist(
                        itemsRoutine(playlist), {
                            name: playlist.attributes.name,
                            description: playlist.attributes.description,
                            open: playlist.attributes.accessType === "PUBLIC"
                        }
                    ))
                    return {url: res.links.next, items: items}
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
    // const transferRoutine = (item, country, index = 0, attempt = 0) => {
    //     // always start the routine after an exponentially higher time (to be increased after failures)
    //     new Promise(handler => setTimeout(handler, 10 ** attempt)).then(() => {
    //         // if the items length is surpassed, stop the routine since the transferring is done
    //         if (index >= transfer.items.length) {
    //             transfer.done()
    //             return
    //         }
    //         const tracks = transfer.items.slice(index, index + 20).map(it => it.data.isrc)
    //         // otherwise, start from requesting the data of up to 20 tracks using the ISRC as identifier
    //         request(
    //             "tracks?countryCode=" + country + tracks.map(isrc => "&filter[isrc]=" + isrc).join(""),
    //             this.token
    //         ).done(res => {
    //             // map the results into a dictionary indexed by isrc to guarantee that the results are correctly ordered
    //             const ids = Object.fromEntries(res.data.map(it => [it.attributes.isrc, it.id]))
    //             // if the request goes well, use the retrieved data to get the track IDs and add them to the playlist, then:
    //             //  - update the number of transferred items and proceed with the next recursive call in case of success
    //             //  - or restart the routine at the current step increasing the number of attempts
    //             request(
    //                 "playlists/" + item + "/relationships/items?countryCode=" + country,
    //                 this.token, {
    //                     method: "POST",
    //                     accept: "*/*",
    //                     contentType: "application/vnd.api+json",
    //                     data: tracks.map(isrc => ids[isrc]).map(id => new Object({id: id, type: "tracks"}))
    //                 }
    //             ).done(_ => {
    //                 transfer.increment(res.data.length)
    //                 transferRoutine(item, index + 20, 0)
    //             }).fail(_ => transferRoutine(item, index, attempt + 1)).always(apply)
    //         }).fail(_ => transferRoutine(item, index, attempt + 1)).always(apply)
    //     })
    // }
    this.check({
        apply: apply,
        fail: () => transfer.abort(),
        done: res => {
            const user = {id: res.data.id, country: res.data.attributes.country, locale: navigator.language}
            switch (transfer.type) {
                case "artists":
                    break
                case "albums":
                    break
                case "tracks":
                    break
                case "playlists":
                    const tracks = transfer.items.slice(index, index + 20).map(it => it.data.isrc)
                    this.transferRecursive({
                        get_url: "tracks?countryCode=" + user.country + tracks.map(isrc => "&filter[isrc]=" + isrc).join(""),
                    })
            }


            // use the retrieved user id to build the various query links
            request(
                "playlists?countryCode=" + user.country,
                this.token, {
                    method: "POST",
                    contentType: "application/vnd.api+json",
                    data: {
                        attributes: {
                            name: transfer.data.name,
                            description: transfer.data.description,
                            accessType: transfer.data.open ? "PUBLIC" : "UNLISTED"
                        },
                        type: "playlists"
                    }
                }
            )
                // in case of success, start to fill the new playlist using its id
                .done(res => transferRoutine(res.data.id))
                // otherwise, call the abort function and stop
                .fail(res => {
                    transfer.abort()
                    console.warn("Error when creating new playlist: " + transfer.name, res)
                })
                .always(apply)
        }
    })
}

export const sourceTidal = new SourceService({fetch: fetch, check: check, ...data})

export const targetTidal = new TargetService({transfer: transfer, check: check, ...data})
