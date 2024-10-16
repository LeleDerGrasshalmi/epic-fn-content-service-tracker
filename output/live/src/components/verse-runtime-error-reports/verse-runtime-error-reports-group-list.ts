// Copyright Epic Games, Inc. All Rights Reserved.

/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-empty-function */

import type { VerseRuntimeErrorCrashGroup } from "@app/types";
import config from "@www/config";
ko.options.deferUpdates = true;

import VerseRuntimeErrorReportModal from "@www/components/verse-runtime-error-reports/verse-runtime-error-report-modal";
VerseRuntimeErrorReportModal.RegisterComponents(config);

type ParentInterface = object;

interface ComponentConfig
{}

interface ComponentParams
{
    parent: ParentInterface,
    source$: KnockoutObservableArray<VerseRuntimeErrorCrashGroup>,
    hasMore$: KnockoutObservable<boolean>;
    loadMore: () => void;
}

class VerseRuntimeErrorReportsGroupList
{
    public static RegisterComponents(_config: ComponentConfig) : void
    {
        ko.components.register("verse-runtime-error-reports-group-list", {
            template: { fromUrl: `/src/components/verse-runtime-error-reports/verse-runtime-error-reports-group-list.html` },
            viewModel: {
                createViewModel: function(params, info)
                {
                    return new VerseRuntimeErrorReportsGroupList(params, (<any>info));
                }
             },
        });
    }

    public $rootEl: JQuery;
    protected readonly _parent: ParentInterface;

    // unique identifier for this component instance.
    public readonly componentId = performance.now();

    public readonly verseRuntimeErrorReportModal: VerseRuntimeErrorReportModal;

    public readonly source$ = ko.observableArray<VerseRuntimeErrorCrashGroup>([]);
    public readonly hasMore$ = ko.observable<boolean>(false);
    public readonly loadMore = () => { };

    public readonly form = {
        searchResults$: ko.observableArray<VerseRuntimeErrorCrashGroup>([]),
        hasMore$: ko.observable<boolean>(false),
        _limit: 0,
        _total: 0,
        _initialized: false,
    };

    constructor(params: ComponentParams, rootEl: Node)
    {
        this._parent = params.parent;
        this.$rootEl = $(rootEl as HTMLElement);

        this.verseRuntimeErrorReportModal = new VerseRuntimeErrorReportModal(this._parent);

        this.source$ = params.source$;
        this.hasMore$ = params.hasMore$;
        this.loadMore = params.loadMore;
    }

    public showGroup(group: VerseRuntimeErrorCrashGroup) : void
    {
        this.verseRuntimeErrorReportModal.show(group);
    }
}

export default VerseRuntimeErrorReportsGroupList;