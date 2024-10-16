// Copyright Epic Games, Inc. All Rights Reserved.

import type { VerseRuntimeErrorCrashGroup, VerseRuntimeErrorCrashReport } from "@app/types";

type ParentInterface = object;

interface ComponentConfig
{}

class VerseRuntimeErrorReportModal
{
    public static RegisterComponents(_config: ComponentConfig) : void
    {
        ko.components.register("verse-runtime-error-report-modal", {
            template: { fromUrl: `/src/components/verse-runtime-error-reports/verse-runtime-error-report-modal.html` },
            viewModel: { fromContextType: VerseRuntimeErrorReportModal },
        });
    }

    public modalId: string;

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    // form fields
    public readonly form = {
        runtimeErrorGroup$: ko.observable<VerseRuntimeErrorCrashGroup>(),
        currentRuntimeErrorReport$: ko.observable<VerseRuntimeErrorCrashReport>(),
    };

    constructor(parent: ParentInterface)
    {
        this._parent = parent;
        this.modalId = "verseRuntimeErrorReportModal";

        this.form.runtimeErrorGroup$.subscribe((group) => {
            if (!group) {
                return;
            }
            this.form.currentRuntimeErrorReport$(group.topCrash);
        });
    }

    protected _init(group: VerseRuntimeErrorCrashGroup) : void
    {
        this._$modal = this.$rootEl.children().first();
        this.form.runtimeErrorGroup$(group);
    }

    public show(group: VerseRuntimeErrorCrashGroup) : void
    {
        this._init(group);
        this._$modal.modal({
            show: true,
            keyboard: false,
            backdrop: "static",
        });
    }

    public hide = () : void =>
    {
        this._$modal.modal("hide");
    }
}

export default VerseRuntimeErrorReportModal;