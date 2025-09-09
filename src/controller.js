import {Dummy} from "./service.js"
import {File} from "./file.js"
import {Tidal} from "./tidal.js"
import {Spotify} from "./spotify.js"

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services and default choices (set source and target to a dummy service if none is selected)
    $scope.services = {
        dummy: new Dummy(() => $scope.$apply()),
        file: new File(() => $scope.$apply()),
        tidal: new Tidal(() => $scope.$apply()),
        spotify: new Spotify(() => $scope.$apply())
    }
    $scope.choices = {
        source: $scope.services[sessionStorage.getItem("source")] || $scope.services.dummy,
        target: $scope.services[sessionStorage.getItem("target")] || $scope.services.dummy,
        group: undefined,
        animation: undefined
    }
    const selected = {source: $scope.choices.source, target: $scope.choices.target}
    selected.source.select()
    selected.target.select()

    // if a code can be retrieved in the location and a service is waiting for it, try to exchange the token
    const waiting = sessionStorage.getItem("waiting")
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code && waiting) {
        $scope.services[waiting].exchange(code, params.get("state"))
            // in case of success, also fetch the data if the waiting service is the source
            .then(() => fetch(waiting === "source"))
            // in case of failure, if the result has a status it means that there was an error during the request,
            // otherwise it means that the given state was wrong and the exchange method itself rejected the deferred
            .catch(res => fail(res, waiting, "The server responded with " + (res.status ? "an error after token exchange request" : "a wrong state code")))
            .always(() => {
                // always unset the "waiting" variable after an exchange
                sessionStorage.removeItem("waiting")
                $scope.$apply()
            })
        // use history.pushState to remove the query without reloading the page
        history.pushState({}, null, location.pathname)
    }

    // update handler for source and transfer change
    $scope.update = () => {
        // handle prohibited cases:
        //   - if the source is dummy, the target must be dummy as well
        //   - if the services coincide, either reset the target to its old value if it was dummy, or swap them
        if ($scope.choices.source === $scope.services.dummy) {
            $scope.choices.target = $scope.services.dummy
        } else if ($scope.choices.source === $scope.choices.target) {
            if (selected.target === $scope.services.dummy) {
                $scope.choices.target = $scope.services.dummy
            } else {
                $scope.choices.source = selected.target
                $scope.choices.target = selected.source
            }
        }
        // handle source/target changes
        const waiting = $scope.services[sessionStorage.getItem("waiting")]
        for (const source of [true, false]) {
            const role = source ? "source" : "target"
            const newService = $scope.choices[role]
            const oldService = selected[role]
            // if the two services are different, deselect the old one then assign and select the new one
            if (newService !== oldService) {
                sessionStorage.setItem(role, newService.name)
                selected[role] = newService
                newService.select(source)
                oldService.deselect()
            }
            // if the service has a token, try to fetch the results (if it is the source)
            // otherwise, try to log in unless it is waiting
            if (newService.token) {
                fetch(source)
            } else if (newService !== waiting) {
                newService.login()
                    .then(res => {
                        // if a URL is returned, set the waiting variable and relocate to get the code
                        if (res instanceof URL) {
                            sessionStorage.setItem("waiting", newService.name)
                            location = res
                        }
                    })
                    .catch(res => fail(res, role, "The server responded with an error after the authentication request"))
                    .always(() => $scope.$apply())
            }
        }
    }

    // transfer handler for button click
    $scope.transfer = () => {
        $scope.choices.target.transfer($scope.choices.group)
        $scope.choices.animation = ">~~~~~~~~"
        animate()
    }

    // selection handler for batch operations
    $scope.selection = selected => $scope.choices.group.items.map(it => it.selected = selected)

    // utility functions

    function fetch(source) {
        // fetch only if "source" is true
        if (!source) return
        selected.source.fetch()
            .then(() => $scope.error = undefined)
            .then(() => $scope.choices.group = selected.source.groups[0])
            .catch(res => fail(res, "source", "The server responded with an error after the fetch request"))
            .always(() => $scope.$apply())
    }

    function fail(res, role, message) {
        $scope.error = message
        console.warn(message, res)
        $scope.choices[role] = $scope.services.dummy
        $scope.update()
    }

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
            $scope.$apply()
        }, 200)
    }
})