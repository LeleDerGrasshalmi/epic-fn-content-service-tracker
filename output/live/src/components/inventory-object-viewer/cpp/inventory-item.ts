import { FInventory } from "./inventory";
import { EJsonNone, EJsonNull, FJsonObject, FJsonValue, isEJsonObject, FJsonValue_CompareEqual, NewJsonObject } from "./f-json-types";

export const PATH_SEPARATOR = "/";

function isLegalItemPath(segment: string, bAllowSlash: boolean): boolean
{
    if (segment === null || segment === undefined)
        throw new Error("argument null: segment");

    // "" is not allowed for a segment (though it is allowed as a special case for a full absolute path)
	if (segment.length <= 0)
	{
		return false;
	}

	// check for illegal characters
	let pathStart = -1;
	for (let i = 0; i < segment.length; ++i)
	{
		const ch = segment[i];

		// lower case only
		if (ch >= 'a' && ch <= 'z')
			continue;

		// numbers
		if (ch >= '0' && ch <= '9')
			continue;

		// path segments must start with a-z0-9 (checked already above)
		if (i === pathStart + 1)
			return false;

		// slash (conditional)
		if (ch === '/')
		{
			if (bAllowSlash)
			{
				pathStart = i;
				continue;
			}
			return false;
		}

		// any other exceptions
		switch (ch)
		{
            case '-':
            case '_':
            case '.':
                break;

            default:
                // illegal character
                return false;
		}
	}

	return true;
}

export class FInventoryItem
{
    protected readonly _deletedSubItems = new Map<string, FInventoryItem>();

    public readonly subItems = new Map<string, FInventoryItem>();

    protected _rootValue: FJsonValue = NewJsonObject();
    public get rootValue() { return this._rootValue; }

    public readonly inventory: FInventory;

    public readonly itemName: string;

    public readonly fullPath: string;

    public bIsDeleted: boolean = false;

    public constructor(inventoryIn: FInventory, pathIn: string)
    {
        this.inventory = inventoryIn;
        this.fullPath = pathIn;
        this.itemName = pathIn.split(PATH_SEPARATOR).pop()!;
    }

    /** FInventoryItem::FindItem */
    public findItem(matchString: string, currentSegmentIdx: number): FInventoryItem | undefined
    {
        // check(matchString)
        if (matchString === undefined || matchString.length <= 0)
            throw new Error("argument null or empty: matchString");

        // get the path segment we are matching currently.
        const segmentsCollection = matchString.split(PATH_SEPARATOR);
        const segment = segmentsCollection[currentSegmentIdx];

        // check for empty segment (either "" or a string with "//" in it) and segments with bad characters.
        if (isLegalItemPath(segment, false))
        {
            // does an item exist at this path
            const existingItem = this.subItems.get(segment);
            if (existingItem !== undefined)
            {
                // should we recurse?
                const segmentsCollectionEndIdx = segmentsCollection.length - 1;
                if (currentSegmentIdx < segmentsCollectionEndIdx)
                {
                    const nextSegmentIdx = currentSegmentIdx + 1;
                    return existingItem.findItem(matchString, nextSegmentIdx);
                }
                return existingItem;
            }
        }

        // could not find (or illegal path)
        return undefined;
    }

    /** FInventoryItem::FindOrCreateItem */
    public findOrCreateItem(matchString: string, currentSegmentIdx: number): FInventoryItem | undefined
    {
        // check(matchString)
        if (matchString === undefined || matchString.length <= 0)
            throw new Error("argument null or empty: matchString");

        // get the path segment we are matching currently.
        const segmentsCollection = matchString.split(PATH_SEPARATOR);
        const segment = segmentsCollection[currentSegmentIdx];

        // check for empty segment (either "" or a string with "//" in it) and segments with bad characters
        if (!isLegalItemPath(segment, false))
        {
            // illegal subpath
            return undefined;
        }

        // find or create the sub item (if we can)
        let item: FInventoryItem;
        const existingItem = this.subItems.get(segment);
        if (existingItem !== undefined)
        {
            item = existingItem;
        }
        else if (!isEJsonObject(this.rootValue) || this.rootValue[segment] === undefined)
        {
            const deletedItem = this._deletedSubItems.get(segment);
            if (deletedItem !== undefined)
            {
                // resurrect this deleted subitem
                item = deletedItem;
                item.bIsDeleted = false;
                this._deletedSubItems.delete(segment);
                this.subItems.set(segment, item);
            }
            else
            {
                // create a new subitem
                const newItem = new FInventoryItem(this.inventory, `${this.fullPath}${PATH_SEPARATOR}${segment}`);
                this.subItems.set(segment, newItem);
                item = newItem;
            }
        }
        else
        {
            // invalid subpath (collision with real value)
            return undefined;
        }

        // should we recurse?
        const segmentsCollectionEndIdx = segmentsCollection.length - 1;
        if (currentSegmentIdx < segmentsCollectionEndIdx)
        {
            const nextSegmentIdx = currentSegmentIdx + 1;
            return item.findOrCreateItem(matchString, nextSegmentIdx);
        }

        return item;
    }

    /*** FInventoryItem::UpdateValueFromJson */
    public updateValueFromJson(newValue: FJsonValue, bForceUpdate: boolean): void
    {
        if (this.bIsDeleted)
            throw new Error("cannot update deleted item");

        if (newValue === EJsonNull || newValue === EJsonNone)
        {
            this._rootValue = NewJsonObject();
        }
        else
        {
            // make sure newValue is different from rootValue
            if (!bForceUpdate && FJsonValue_CompareEqual(this.rootValue, newValue))
                return // suppress this update (it changes nothing)

            // re-value this node
            this._rootValue = newValue;

            if (isEJsonObject(newValue))
            {
                if (this.subItems.size > 0)
                {
                    const objValue = newValue;

                    // scrape out any subcontainers colliding with keys in the object
                    for (const [key, value] of this.subItems.entries())
                    {
                        if(objValue[key] !== undefined)
                        {
                            const item: FInventoryItem = value;
                            item.removeAllSubitems();
                            this.onSubItemRemoved(value);
                        }
                    }
                }
            }
        }
    }

    /*** FInventoryItem::RemoveSubItem */
    public removeAllSubitems(): void
    {
        if (this.bIsDeleted)
            throw new Error("item is deleted.");

        // remove all subitems (recurses)
        for (const [_key, value] of this.subItems.entries())
        {
            value.removeAllSubitems();
            this.onSubItemRemoved(value);
        }
        this.subItems.clear();
    }

    /*** FInventoryItem::OnSubItemRemoved */
    public onSubItemRemoved(item: FInventoryItem): void
    {
        // reset its root node
        item._rootValue = NewJsonObject();

        // flag it as dirty
        item.flagAsDirty();

        // move it to the deleted sub items array
        item.bIsDeleted = true;
        this._deletedSubItems.set(item.itemName, item);
    }

    /*** FInventoryItem::FlagAsDirty */
    public flagAsDirty(): void
    {
        throw new Error("Not Implemented");
    }

    /*** FInventoryItem::ConstructDocument */
    public constructDocument(): FJsonObject
    {

        // first make sure our root item is an object (if it were missing the default would be an empty object)
        if (!isEJsonObject(this.rootValue))
        {
            // this is not a valid operation on scalars.
            return NewJsonObject();
        }

        // if we have no sub-objects, then the root item is the document (useful shortcut, this happens often)
        if (this.subItems.size <= 0)
        {
            return this.rootValue;
        }

        // ok, we need to merge the root item with subitems, first copy the root.
        const document: FJsonObject = NewJsonObject();
        this.mergeWithDocument(document);
        return document;
    }

    /*** FInventoryItem::MergeWithDocument */
    public mergeWithDocument(document: FJsonObject)
    {
        // merge values from our root item
        if (!isEJsonObject(this.rootValue))
        {
            // check(RootValue->Type === EJson::Object)
            throw new Error("MergeWithDocument isn't allowed on non-object roots");
        }

        for (const [key, value] of Object.entries(this.rootValue))
        {
            document[key] = value;
        }

        // merge values from SubItems
        for (const [key, item] of this.subItems.entries())
        {
            // is the item a scalar value
            if (!isEJsonObject(item.rootValue))
            {
                // for non-object subitems, simply clobber the value
                document[key] = item.rootValue;
            }
            else
            {
                // get the current value in the document
                const currentSubValue = document[key];

                // is this value mergable
                if (isEJsonObject(currentSubValue))
                {
                    // make new document to represent the merged value
                    let subDocument = NewJsonObject();
                    subDocument = { ...currentSubValue };

                    // merge with this
                    item.mergeWithDocument(subDocument);

                    // apply to this document
                    document[key] = subDocument;
                }
                else if(item.subItems.size <= 0)
                {
                    // shortcut: just clobber with the root item
                    document[key] = item.rootValue;
                }
                else
                {
                    // merge root and all SubItems
                    const subDocument = NewJsonObject();
                    item.mergeWithDocument(subDocument);

                    // set the key
                    document[key] = subDocument;
                }
            }
        }
    }
}