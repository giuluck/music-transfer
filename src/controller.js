import {sourceDummy, targetDummy} from "./service.js"
import {sourceFile, targetFile} from "./file.js"
import {sourceTidal, targetTidal} from "./tidal.js"
import {sourceSpotify, targetSpotify} from "./spotify.js"

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services and default choices (set source and target to a dummy service if none is selected)
    $scope.sources = {Dummy: sourceDummy, File: sourceFile, Tidal: sourceTidal, Spotify: sourceSpotify}
    $scope.targets = {Dummy: targetDummy, File: targetFile, Tidal: targetTidal, Spotify: targetSpotify}
    $scope.choices = {
        source: Object.values($scope.sources).filter(it => it.selected)[0] || sourceDummy,
        target: Object.values($scope.targets).filter(it => it.selected)[0] || targetDummy,
        group: undefined,
        animation: undefined
    }
    const services = {source: sourceDummy, target: targetDummy}

    // if a code can be retrieved in the location, use the "waiting" flag to understand which service is waiting
    // then try to exchange the token and eventually to fetch the results in case of success
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code) {
        const waiting = sessionStorage.getItem("waiting")
        for (const source of [true, false]) {
            const service = $scope.choices[source ? "source" : "target"]
            if (service.name === waiting) {
                service.exchange({
                    code: code,
                    state: params.get("state"),
                    done: () => {
                        $scope.error = undefined
                        $scope.choices.source.fetch({
                            done: () => $scope.choices.group = $scope.choices.source.groups[0],
                            fail: failFetching,
                            apply: apply
                        })
                    },
                    fail: res => failExchange(res, waiting === "source"),
                    apply: apply
                })
            }
        }
        // use history.pushState to remove the query without reloading the page
        history.pushState({}, null, location.pathname)
    }
    // update handler for source and transfer change
    $scope.update = () => {
        // handle prohibited cases:
        //   - if the source is dummy, the target must be dummy as well
        //   - if the services coincide, either reset the target to its old value if it was dummy, or swap them
        if ($scope.choices.source === sourceDummy) {
            $scope.choices.target = targetDummy
        } else if ($scope.choices.source.name === $scope.choices.target.name) {
            if (services.target === targetDummy) {
                $scope.choices.target = targetDummy
            } else {
                $scope.choices.source = $scope.sources[services.target.name]
                $scope.choices.target = $scope.targets[services.source.name]
            }
        }
        // handle source/target changes
        for (const source of [true, false]) {
            const role = source ? "source" : "target"
            const newService = $scope.choices[role]
            const oldService = services[role]
            // if the two services are different, deselect the old one then assign and select the new one
            if (newService !== oldService) {
                services[role] = newService
                oldService.deselect()
                newService.select()
            }
            // if the service is not waiting and not already logged, try to log in
            if (!newService.waiting && !newService.logged) {
                newService.login({fail: err => failAuthentication(err, source), apply: apply})
            }
        }
        // if the source is logged, try to fetch the results
        const source = services.source
        if (source.logged) {
            source.fetch({
                done: () => {
                    // take the groups from the $scope rather than the service in case it was changed meanwhile
                    $scope.choices.group = $scope.choices.source.groups[0]
                    $scope.error = undefined
                },
                fail: res => {
                    // if the token is wrong or expired (Error 401) clear the service and select it again
                    if (res.status === 401) {
                        source.clear()
                        source.login({fail: err => failAuthentication(err, true), apply: apply})
                    } else {
                        failFetching(res)
                    }
                },
                apply: apply
            })
        }
    }

    // transfer handler for button click
    $scope.transfer = () => {
        $scope.choices.target.transfer({group: $scope.choices.group, apply: apply})
        $scope.choices.animation = ">~~~~~~~~"
        animate()
    }

    // selection handler for batch operations
    $scope.selection = selected => $scope.choices.group.items.map(it => it.selected = selected)

    // utility functions

    function animate() {
        // recursive call to animate the transfer string
        setTimeout(() => {
            if ($scope.choices.target.finished) {
                $scope.choices.animation = "~~~~~~~~~"
            } else {
                const head = $scope.choices.animation.slice(0, -1)
                const tail = $scope.choices.animation.slice(-1)
                $scope.choices.animation = tail + head
                animate()
            }
            apply()
        }, 200)
    }

    function apply() {
        $scope.$apply()
    }

    function failAuthentication(res, source) {
        fail(res, source, "The server responded with an error after the authentication request")
    }

    function failFetching(res) {
        fail(res, true, "The server responded with an error after the fetch request")
    }

    function failExchange(res, source) {
        // if the result has a status it means that there was an error during the request, otherwise it means
        // that the given state was wrong and the exchange method directly launched the failure routine itself
        fail(res, source, res.status ?
            "The server responded with an error after token exchange request" :
            "The server responded with a wrong state code")
    }

    function fail(res, source, message) {
        $scope.error = message
        console.warn(message, res)
        if (source) {
            $scope.choices.source.clear()
            $scope.choices.source = sourceDummy
        } else {
            $scope.choices.target.clear()
            $scope.choices.target = targetDummy
        }
        $scope.update()
    }
})