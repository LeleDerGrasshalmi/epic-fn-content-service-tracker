export type MappedObservable<T extends object, K extends [...(keyof T)[]] = []> = {
    [K2 in Exclude<keyof T, K[number]> as `${Extract<K2, string>}$`]: T[K2] extends Function ? T[K2] : KnockoutObservable<T[K2]>
} & {
    [K3 in keyof Pick<T, K[number]>]: T[K3]
}
& {
    unmap: () => T
}

export function toMappedObservable<T extends Record<string, any>, K extends [...(keyof T)[]] = []>(obj: T, ...skip: K): MappedObservable<T, K>
{
    const mappedObj = {} as MappedObservable<T, K>;
    const mappedKeys = [] as string[];

    let key: Extract<keyof MappedObservable<T, K>, string>;
    for(key in obj)
    {
        if (typeof obj[key] === "function" || skip.includes(key))
        {
            // skip functions and explicitly named keys.
            mappedObj[key] = obj[key];
            continue;
        }

        (<any>mappedObj)[`${key}$`] = ko.observable(obj[key]) as any;
        mappedKeys.push(key);
    }

    mappedObj.unmap = () => {
        const unmapped = { ...obj };

        for (const key in obj)
        {
            if (mappedKeys.includes(key))
                (<any>unmapped)[key] = (<any>mappedObj)[`${key}$`]();
        }

        return unmapped;
    };

    return mappedObj;
}

export function toMappedObservableArray<T extends Record<string, any>, K extends [...(keyof T)[]] = []>(source: T[], ...skip: K): MappedObservable<T, K>[]
{
    const result: MappedObservable<T, K>[] = [];
    for(const obj of source)
        result.push(toMappedObservable(obj, ...skip));

    return result;
}