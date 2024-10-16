export type FJsonValue = number|string|boolean|Array<FJsonValue>|{ [key:string]: FJsonValue };
export type FJsonObject = { [path: string]: FJsonValue };

export const EJsonNull = null;
export const EJsonNone = undefined;

export function NewJsonObject()
{
    return { };
}

export function isEJsonObject(val: any): val is { [path: string]: FJsonValue }
{
    if (val === undefined)
        return false;

    if (val === null)
        return false;

    if (Array.isArray(val))
        return false;

    // no other types resolve to "object"
    return typeof(val) === "object";
}

/*** FJsonValue::CompareEqual */
export function FJsonValue_CompareEqual(lhs: FJsonValue, rhs: FJsonValue): boolean
{
    if (typeof(lhs) !== typeof(rhs))
        return false;

    if (lhs === null || lhs === undefined)
        return true;

    switch(typeof(lhs))
    {
        case "string":
        case "number":
        case "boolean":
            return lhs === rhs;


        case "object":
            if (Array.isArray(lhs))
            {
                const lhsArray = <Array<FJsonValue>>lhs;
                const rhsArray = <Array<FJsonValue>>rhs;

                if (lhsArray.length !== rhsArray.length)
                    return false;

                // compare each element
                for (let i = 0; i < lhs.length; ++i)
                {
                    if (!FJsonValue_CompareEqual(lhsArray[i], rhsArray[i]))
                        return false;
                }
                return true;
            }
            else
            {
                const lhsObj = <{[path: string]: FJsonValue}>lhs;
                const rhsObj = <{[path: string]: FJsonValue}>rhs;

                if ((lhsObj === undefined) !== (rhsObj === undefined))
                    return false;

                if (lhsObj !== undefined)
                {
                    if (Object.keys(lhsObj).length !== Object.keys(rhsObj).length)
                        return false;
                }

                // compare each element
                for (const [key, lhsValue] of Object.entries(lhsObj))
                {
                    const rhsValue = rhsObj[key];
                    if (rhsValue === undefined)
                        return false;   // not found in both objects

                    // TODO: this check doesn't make sense... need to confirm I understand JsonValue.IsValid()
                    if ((lhsValue === undefined) !== (rhsValue === undefined))
                        return false;

                    if (lhsValue !== undefined)
                    {
                        if (!FJsonValue_CompareEqual(lhsValue, rhsValue))
                            return false;
                    }
                }
                return true;
            }

        default:
            throw new Error(`unsupported type: ${typeof(lhs)}`);
    }
}