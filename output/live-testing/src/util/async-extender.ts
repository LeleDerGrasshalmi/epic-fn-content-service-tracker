(<any>ko.extenders).async = function asyncExtender<T>(deferred: () => T | Promise<T>, initialValue: T) 
{
    let cancel: undefined | (() => void);

    const result$ = ko.observable(initialValue);

    ko.computed(() => {
        // cancel any active promise.
        cancel && cancel()
        cancel = undefined;

        new Promise<void>((resolve, reject) => {
            cancel = reject;

            const p = deferred();
            if (p === null || p === undefined || typeof p !== "object" || typeof (<any>p).then !== "function")
            {
                result$(<any>p);
                return resolve();
            }
            else
            {
                (<Promise<T>>p).then((data) => {
                    result$(data);
                    resolve();
                })
                .catch(reject);
            }
        })
        .catch(err => {
            if (err) throw err;
        });
    });

    return result$;
};