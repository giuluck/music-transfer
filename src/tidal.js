import {Playlist} from "./groups.js"
import {SourceService, TargetService} from "./service.js";

const country = navigator.language.split('-')[1]
const locale = navigator.language

const data = {
    name: "Tidal",
    title: "Tidal",
    token: {
        clientID: "CE49NT7wvkwoZ1s3",
        authorizationEndpoint: "https://login.tidal.com/authorize",
        exchangeEndpoint: "https://auth.tidal.com/v1/oauth2/token",
        scope: "collection.read collection.write playlists.read playlists.write"
    }
}

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

function fetch({done, fail, apply}) {
    // recursive fetch routine for delayed tracks fetching in playlists
    // (use const rather than function to have access to the correct "this" object)
    const fetchRoutine = (url, group, attempt = 0) => {
        // always start the routine after an exponentially higher time (to be increased after failures)
        new Promise(handler => setTimeout(handler, 10 ** attempt)).then(() => {
            // if the url is undefined, the fetching process is done
            if (!url) {
                group.done()
                apply()
                return
            }
            // otherwise, send a request to the url
            request(url + "&include=items.artists", this.token)
                .done(res => {
                    // build a dictionary of included information
                    const info = Object.fromEntries(res.included.map(it => [it.id, it]))
                    // recursively call the routine with the next urò
                    fetchRoutine(res.links.next, group, 0)
                    // add each retrieved track to the playlist
                    res.data.forEach(it => {
                        const track = info[it.id]
                        group.add({
                            name: track.attributes.title,
                            artists: track.relationships.artists.data.map(artist => info[artist.id].attributes.name),
                            isrc: track.attributes.isrc
                        })
                    })
                })
                .fail(() => fetchRoutine(url, group, attempt + 1))
                .always(apply)
        })
    }
    // fetch user information to get its identifier
    request("users/me", this.token)
        // use the retrieved user id to query the user collection
        .then(res => request(
            "userCollections/" + res.data.id +
            "?locale=" + locale +
            "&countryCode=" + country +
            "&include=playlists" +
            "&include=artists" +
            "&include=albums" +
            "&include=albums.artists",
            this.token
        ))
        // map the user collection into sets of items
        .then(res => {
            // build a dictionary of included information
            const info = Object.fromEntries(res.included.map(it => [it.id, it]))
            //
            // // build the playlists
            // const playlists = res.data.relationships.playlists.data
            //     .map(playlist => info[playlist.id])
            //     .map(playlist => new Playlist({
            //         name: playlist.attributes.name,
            //         description: playlist.attributes.description,
            //         open: playlist.attributes.accessType === "PUBLIC",
            //         length: playlist.attributes.numberOfItems,
            //         routine: group => routine(playlist.relationships.items.links.self, 1, group)
            //     }))
            // // build the favourite albums group
            // const albums = new Albums({
            //     items: res.data.relationships.albums.data.map(it => {
            //         const album = info[it.id]
            //         return {
            //             name: album.attributes.title,
            //             artists: album.relationships.artists.data.map(artist => info[artist.id].attributes.name),
            //             barcode: album.attributes.barcodeId,
            //         }
            //     })
            // })
            // // build the favourite artists groups
            // const artists = new Artists({
            //     items: res.data.relationships.artists.data.map(it => {
            //         const artist = info[it.id]
            //         return {name: artist.attributes.name}
            //     })
            // })
            // return [artists, albums, ...playlists]
            //
            return res.data.relationships.playlists.data
                .map(playlist => info[playlist.id])
                .map(playlist => new Playlist({
                    name: playlist.attributes.name,
                    description: playlist.attributes.description,
                    open: playlist.attributes.accessType === "PUBLIC",
                    length: playlist.attributes.numberOfItems,
                    routine: group => fetchRoutine(playlist.relationships.items.links.self, group)
                }))
        })
        // call the conclusive routines
        .done(done)
        .fail(fail)
        .always(apply)
}


function transfer({transfer, apply}) {
    // recursive transfer routine to fetch playlist track IDs from ISRC code and then push them to the new playlist
    // (use const rather than function to have access to the correct "this" object)
    const transferRoutine = (playlist, index = 0, attempt = 0) => {
        // always start the routine after an exponentially higher time (to be increased after failures)
        new Promise(handler => setTimeout(handler, 10 ** attempt)).then(() => {
            // if the items length is surpassed, stop the routine since the transferring is done
            if (index >= transfer.items.length) {
                transfer.done()
                return
            }
            const tracks = transfer.items.slice(index, index + 20).map(it => it.data.isrc)
            // otherwise, start from requesting the data of up to 20 tracks using the ISRC as identifier
            request(
                "tracks?countryCode=" + country + tracks.map(isrc => "&filter[isrc]=" + isrc).join(""),
                this.token
            ).done(res => {
                // map the results into a dictionary indexed by isrc to guarantee that the results are correctly ordered
                const ids = Object.fromEntries(res.data.map(it => [it.attributes.isrc, it.id]))
                // if the request goes well, use the retrieved data to get the track IDs and add them to the playlist, then:
                //  - update the number of transferred items and proceed with the next recursive call in case of success
                //  - or restart the routine at the current step increasing the number of attempts
                request(
                    "playlists/" + playlist + "/relationships/items?countryCode=" + country,
                    this.token, {
                        method: "POST",
                        accept: "*/*",
                        contentType: "application/vnd.api+json",
                        data: tracks.map(isrc => ids[isrc]).map(id => new Object({id: id, type: "tracks"}))
                    }
                ).done(_ => {
                    transfer.increment(res.data.length)
                    transferRoutine(playlist, index + 20, 0)
                }).fail(_ => transferRoutine(playlist, index, attempt + 1)).always(apply)
            }).fail(_ => transferRoutine(playlist, index, attempt + 1)).always(apply)
        })
    }
    // create a new playlist with the Transfer object information
    request(
        "playlists?countryCode=" + country,
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

export const sourceTidal = new SourceService({fetch: fetch, ...data})

export const targetTidal = new TargetService({transfer: transfer, ...data})
