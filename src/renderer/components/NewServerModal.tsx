// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {Modal, Button, FormGroup, FormControl, FormLabel, FormText, Spinner} from 'react-bootstrap';
import type {IntlShape} from 'react-intl';
import {FormattedMessage, injectIntl} from 'react-intl';

import {URLValidationStatus} from 'common/utils/constants';
import Toggle from 'renderer/components/Toggle';

import type {UniqueServer} from 'types/config';
import type {Permissions} from 'types/permissions';
import type {URLValidationResult} from 'types/server';

import 'renderer/css/components/NewServerModal.scss';

const PLATRUM_CHAT_SUFFIX = '.chat.platrum.ru';
const PROJECT_HOST_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VALIDATION_DEBOUNCE_MS = 350;
const VALIDATION_TIMEOUT_MS = 5000;

const getProjectHostFromURL = (url: string): string => {
    let host = url.trim();
    host = host.toLowerCase();
    host = host.replace(/^https?:\/\//, '');
    host = host.split('/')[0];
    host = host.split('?')[0];
    host = host.split('#')[0];
    host = host.split(':')[0];

    if (host.endsWith(PLATRUM_CHAT_SUFFIX)) {
        host = host.slice(0, -PLATRUM_CHAT_SUFFIX.length);
    }

    if (host.endsWith('.platrum.ru')) {
        host = host.slice(0, -'.platrum.ru'.length);
    }

    return host;
};

const getProjectURLFromHost = (host: string): string => {
    if (!host) {
        return '';
    }
    return `https://${host}${PLATRUM_CHAT_SUFFIX}`;
};

type Props = {
    onClose?: () => void;
    onSave?: (server: UniqueServer, permissions?: Permissions) => void;
    server?: UniqueServer;
    permissions?: Permissions;
    editMode?: boolean;
    show?: boolean;
    restoreFocus?: boolean;
    currentOrder?: number;
    setInputRef?: (inputRef: HTMLInputElement) => void;
    intl: IntlShape;
    prefillURL?: string;
};

type State = {
    serverName: string;
    serverHost: string;
    serverUrl: string;
    serverId?: string;
    serverOrder: number;
    saveStarted: boolean;
    validationStarted: boolean;
    validationResult?: URLValidationResult;
    permissions: Permissions;
    cameraDisabled: boolean;
    microphoneDisabled: boolean;
}

class NewServerModal extends React.PureComponent<Props, State> {
    wasShown?: boolean;
    serverUrlInputRef?: HTMLInputElement;
    validationTimeout?: NodeJS.Timeout;
    mounted: boolean;

    static defaultProps = {
        restoreFocus: true,
    };

    constructor(props: Props) {
        super(props);

        this.wasShown = false;
        this.mounted = false;
        this.state = {
            serverName: '',
            serverHost: '',
            serverUrl: '',
            serverOrder: props.currentOrder || 0,
            saveStarted: false,
            validationStarted: false,
            permissions: {},
            cameraDisabled: false,
            microphoneDisabled: false,
        };
    }

    componentDidMount(): void {
        this.mounted = true;
    }

    componentWillUnmount(): void {
        this.mounted = false;
        clearTimeout(this.validationTimeout as unknown as number);
    }

    componentDidUpdate(prevProps: Readonly<Props>): void {
        if (this.props.prefillURL && this.props.prefillURL !== prevProps.prefillURL) {
            const serverHost = getProjectHostFromURL(this.props.prefillURL);
            this.setState({
                serverName: serverHost,
                serverHost,
                serverUrl: getProjectURLFromHost(serverHost),
            });
            this.validateServerURL(getProjectURLFromHost(serverHost));
        }
    }

    initializeOnShow = async () => {
        const cameraDisabled = window.process.platform === 'win32' && await window.desktop.getMediaAccessStatus('camera') !== 'granted';
        const microphoneDisabled = window.process.platform === 'win32' && await window.desktop.getMediaAccessStatus('microphone') !== 'granted';

        this.setState({
            serverName: this.props.server ? getProjectHostFromURL(this.props.server.url) : '',
            serverHost: this.props.server ? getProjectHostFromURL(this.props.server.url) : '',
            serverUrl: this.props.server ? this.props.server.url : '',
            serverId: this.props.server?.id,
            saveStarted: false,
            validationStarted: false,
            validationResult: undefined,
            permissions: this.props.permissions ?? {},
            cameraDisabled,
            microphoneDisabled,
        });

        if (this.props.editMode && this.props.server) {
            this.validateServerURL(this.props.server.url);
        }
    };

    handleServerNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({
            serverName: e.target.value,
        });
    };

    handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const serverHost = getProjectHostFromURL(e.target.value);
        const serverUrl = getProjectURLFromHost(serverHost);
        this.setState({serverName: serverHost, serverHost, serverUrl, validationResult: undefined});
        this.validateServerURL(serverUrl);
    };

    handleChangePermission = (permissionKey: string) => {
        return (e: React.ChangeEvent<HTMLInputElement>) => {
            this.setState({
                permissions: {
                    ...this.state.permissions,
                    [permissionKey]: {
                        allowed: e.target.checked,
                        alwaysDeny: e.target.checked ? undefined : true,
                    },
                },
            });
        };
    };

    validateProjectHost = (projectHost: string): URLValidationResult | undefined => {
        if (!projectHost.length) {
            return {status: URLValidationStatus.Missing};
        }

        if (!PROJECT_HOST_REGEX.test(projectHost)) {
            return {status: URLValidationStatus.Invalid};
        }

        return undefined;
    };

    validateServerURL = (serverUrl: string) => {
        clearTimeout(this.validationTimeout as unknown as number);
        this.validationTimeout = setTimeout(async () => {
            if (!this.mounted) {
                return;
            }

            const projectHost = getProjectHostFromURL(serverUrl);
            const localValidationResult = this.validateProjectHost(projectHost);
            if (localValidationResult) {
                this.setState({
                    validationResult: localValidationResult,
                    validationStarted: false,
                });
                return;
            }

            this.setState({validationStarted: true});

            try {
                const validationResult = await Promise.race<URLValidationResult>([
                    window.desktop.validateServerURL(serverUrl, this.props.server?.id),
                    new Promise<URLValidationResult>((_, reject) => {
                        setTimeout(() => reject(new Error('validation timeout')), VALIDATION_TIMEOUT_MS);
                    }),
                ]);

                if (!this.mounted) {
                    return;
                }

                const validatedURL = validationResult.validatedURL ?? serverUrl;
                this.setState({
                    validationResult,
                    validationStarted: false,
                    serverHost: getProjectHostFromURL(validatedURL),
                    serverUrl: validatedURL,
                    serverName: getProjectHostFromURL(validatedURL),
                });
            } catch (error) {
                if (!this.mounted) {
                    return;
                }
                this.setState({
                    validationResult: {status: URLValidationStatus.NotMattermost},
                    validationStarted: false,
                });
            }
        }, VALIDATION_DEBOUNCE_MS);
    };

    isServerURLErrored = () => {
        const status = this.state.validationResult?.status;
        if (!status) {
            return false;
        }

        if (status === URLValidationStatus.Missing ||
            status === URLValidationStatus.Invalid ||
            status === URLValidationStatus.URLExists ||
            status === URLValidationStatus.NotMattermost) {
            return true;
        }

        if (!this.state.validationResult?.serverVersion) {
            return true;
        }

        return false;
    };

    getServerURLMessage = () => {
        if (this.state.validationStarted) {
            return (
                <div>
                    <Spinner
                        className='NewServerModal-validationSpinner'
                        animation='border'
                        size='sm'
                    />
                    <FormattedMessage
                        id='renderer.components.newServerModal.validating'
                        defaultMessage='Validating...'
                    />
                </div>
            );
        }

        if (!this.state.validationResult) {
            return null;
        }

        switch (this.state.validationResult.status) {
        case URLValidationStatus.Missing:
            return (
                <div
                    id='urlValidation'
                    className='error'
                >
                    <i className='icon-close-circle'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.error.urlRequired'
                        defaultMessage='Project host is required.'
                    />
                </div>
            );
        case URLValidationStatus.Invalid:
            return (
                <div
                    id='urlValidation'
                    className='error'
                >
                    <i className='icon-close-circle'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.error.urlIncorrectFormatting'
                        defaultMessage='Project host is not formatted correctly.'
                    />
                </div>
            );
        case URLValidationStatus.URLExists:
            return (
                <div
                    id='urlValidation'
                    className='warning'
                >
                    <i className='icon-alert-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.error.serverUrlExists'
                        defaultMessage='A project with the same host already exists.'
                    />
                </div>
            );
        case URLValidationStatus.Insecure:
            return (
                <div
                    id='urlValidation'
                    className='warning'
                >
                    <i className='icon-alert-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.warning.insecure'
                        defaultMessage='Your project URL is potentially insecure. For best results, use a URL with the HTTPS protocol.'
                    />
                </div>
            );
        case URLValidationStatus.NotMattermost:
            return (
                <div
                    id='urlValidation'
                    className='warning'
                >
                    <i className='icon-alert-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.warning.notMattermost'
                        defaultMessage='The project host provided does not appear to point to a valid project. Please verify the host and check your connection.'
                    />
                </div>
            );
        case URLValidationStatus.URLNotMatched:
            return (
                <div
                    id='urlValidation'
                    className='warning'
                >
                    <i className='icon-alert-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.warning.urlNotMatched'
                        defaultMessage='The project host does not match your project settings. Please verify the host.'
                    />
                </div>
            );
        case URLValidationStatus.URLUpdated:
            return (
                <div
                    id='urlValidation'
                    className='info'
                >
                    <i className='icon-information-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.warning.urlUpdated'
                        defaultMessage='The project host was adjusted to match your project settings.'
                    />
                </div>
            );
        }

        if (!this.state.validationResult.serverVersion) {
            return (
                <div
                    id='urlValidation'
                    className='warning'
                >
                    <i className='icon-alert-outline'/>
                    <FormattedMessage
                        id='renderer.components.newServerModal.warning.versionUnavailable'
                        defaultMessage='Could not validate project host. Please check the host and try again.'
                    />
                </div>
            );
        }

        return (
            <div
                id='urlValidation'
                className='success'
            >
                <i className='icon-check-circle'/>
                <FormattedMessage
                    id='renderer.components.newServerModal.success.ok'
                    defaultMessage='Project host is valid.'
                />
            </div>
        );
    };

    openNotificationPrefs = () => {
        window.desktop.openNotificationPreferences();
    };

    openWindowsCameraPrefs = () => {
        window.desktop.openWindowsCameraPreferences();
    };

    openWindowsMicrophonePrefs = () => {
        window.desktop.openWindowsMicrophonePreferences();
    };

    getServerNameMessage = () => {
        return null;
    };

    save = () => {
        if (this.props.editMode && this.props.server?.isPredefined) {
            this.setState({
                saveStarted: true,
            }, () => {
                this.props.onSave?.(this.props.server!, this.state.permissions);
            });
        } else {
            if (!this.state.validationResult) {
                return;
            }

            if (this.isServerURLErrored()) {
                return;
            }

            this.setState({
                saveStarted: true,
            }, () => {
                this.props.onSave?.({
                    url: this.state.serverUrl,
                    name: this.state.serverName,
                    id: this.state.serverId,
                }, this.state.permissions);
            });
        }
    };

    getSaveButtonLabel() {
        if (this.props.editMode) {
            return (
                <FormattedMessage
                    id='label.save'
                    defaultMessage='Save'
                />
            );
        }
        return (
            <FormattedMessage
                id='label.add'
                defaultMessage='Add'
            />
        );
    }

    getModalTitle() {
        if (this.props.editMode) {
            return (
                <FormattedMessage
                    id='renderer.components.newServerModal.title.edit'
                    defaultMessage='Edit project'
                />
            );
        }
        return (
            <FormattedMessage
                id='renderer.components.newServerModal.title.add'
                defaultMessage='Add project'
            />
        );
    }

    render() {
        if (this.wasShown !== this.props.show && this.props.show) {
            this.initializeOnShow();
        }
        this.wasShown = this.props.show;

        const notificationValues = {
            link: (msg: React.ReactNode) => (
                <a
                    href='#'
                    onClick={this.openNotificationPrefs}
                >
                    {msg}
                </a>
            ),
        };

        return (
            <Modal
                bsClass='modal'
                className='NewServerModal'
                show={this.props.show}
                id='newServerModal'
                enforceFocus={true}
                onEntered={() => this.serverUrlInputRef?.focus()}
                onHide={this.props.onClose}
                restoreFocus={this.props.restoreFocus}
                onKeyDown={(e: React.KeyboardEvent) => {
                    switch (e.key) {
                    case 'Enter':
                        this.save();

                        // The add button from behind this might still be focused
                        e.preventDefault();
                        e.stopPropagation();
                        break;
                    case 'Escape':
                        this.props.onClose?.();
                        break;
                    }
                }}
            >
                <Modal.Header>
                    <Modal.Title>{this.getModalTitle()}</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    {!(this.props.editMode && this.props.server?.isPredefined) &&
                        <>
                            <form>
                                <FormGroup>
                                    <FormLabel>
                                        <FormattedMessage
                                            id='renderer.components.newServerModal.serverURL'
                                            defaultMessage='Project host'
                                        />
                                    </FormLabel>
                                    <FormControl
                                        id='serverUrlInput'
                                        type='text'
                                        value={this.state.serverHost}
                                        placeholder='example'
                                        onChange={this.handleServerUrlChange}
                                        onClick={(e: React.MouseEvent<HTMLInputElement>) => {
                                            e.stopPropagation();
                                        }}
                                        ref={(ref: HTMLInputElement) => {
                                            this.serverUrlInputRef = ref;
                                            if (this.props.setInputRef) {
                                                this.props.setInputRef(ref);
                                            }
                                        }}
                                        isInvalid={this.isServerURLErrored()}
                                        autoFocus={true}
                                    />
                                    <FormControl.Feedback/>
                                    <FormText>
                                        <FormattedMessage
                                            id='renderer.components.newServerModal.serverURL.description'
                                            defaultMessage='Enter your project host, for example: example'
                                        />
                                    </FormText>
                                </FormGroup>
                                {false && <FormGroup className='NewServerModal-noBottomSpace'>
                                    <FormLabel>
                                        <FormattedMessage
                                            id='renderer.components.newServerModal.serverDisplayName'
                                            defaultMessage='Project display name'
                                        />
                                    </FormLabel>
                                    <FormControl
                                        id='serverNameInput'
                                        type='text'
                                        value={this.state.serverName}
                                        placeholder={this.props.intl.formatMessage({id: 'renderer.components.newServerModal.serverDisplayName', defaultMessage: 'Project display name'})}
                                        onChange={this.handleServerNameChange}
                                        onClick={(e: React.MouseEvent<HTMLInputElement>) => {
                                            e.stopPropagation();
                                        }}
                                        isInvalid={!this.state.serverName.length}
                                    />
                                    <FormControl.Feedback/>
                                    <FormText className='NewServerModal-noBottomSpace'>
                                        <FormattedMessage
                                            id='renderer.components.newServerModal.serverDisplayName.description'
                                            defaultMessage='The name of the project displayed on your desktop app tab bar.'
                                        />
                                    </FormText>
                                </FormGroup>}
                            </form>
                            <div
                                className='NewServerModal-validation'
                            >
                                {this.getServerNameMessage()}
                                {this.getServerURLMessage()}
                            </div>
                        </>
                    }
                    {this.props.editMode &&
                        <>
                            <hr/>
                            <h5>
                                <FormattedMessage
                                    id='renderer.components.newServerModal.permissions.title'
                                    defaultMessage='Permissions'
                                />
                            </h5>
                            <Toggle
                                isChecked={this.state.permissions.media?.allowed}
                                onChange={this.handleChangePermission('media')}
                            >
                                <i className='icon icon-microphone'/>
                                <div>
                                    <FormattedMessage
                                        id='renderer.components.newServerModal.permissions.microphoneAndCamera'
                                        defaultMessage='Microphone and camera'
                                    />
                                    {this.state.cameraDisabled &&
                                        <FormText>
                                            <FormattedMessage
                                                id='renderer.components.newServerModal.permissions.microphoneAndCamera.windowsCameraPermissions'
                                                defaultMessage='Camera is disabled in Windows settings. Click <link>here</link> to open the camera settings.'
                                                values={{
                                                    link: (msg: React.ReactNode) => (
                                                        <a
                                                            href='#'
                                                            onClick={this.openWindowsCameraPrefs}
                                                        >
                                                            {msg}
                                                        </a>
                                                    ),
                                                }}
                                            />
                                        </FormText>
                                    }
                                    {this.state.microphoneDisabled &&
                                        <FormText>
                                            <FormattedMessage
                                                id='renderer.components.newServerModal.permissions.microphoneAndCamera.windowsMicrophoneaPermissions'
                                                defaultMessage='Microphone is disabled in Windows settings. Click <link>here</link> to open the microphone settings.'
                                                values={{
                                                    link: (msg: React.ReactNode) => (
                                                        <a
                                                            href='#'
                                                            onClick={this.openWindowsMicrophonePrefs}
                                                        >
                                                            {msg}
                                                        </a>
                                                    ),
                                                }}
                                            />
                                        </FormText>
                                    }
                                </div>
                            </Toggle>
                            <Toggle
                                isChecked={this.state.permissions.notifications?.allowed}
                                onChange={this.handleChangePermission('notifications')}
                            >
                                <i className='icon icon-bell-outline'/>
                                <div>
                                    <FormattedMessage
                                        id='renderer.components.newServerModal.permissions.notifications'
                                        defaultMessage='Notifications'
                                    />
                                    {window.process.platform === 'darwin' &&
                                    <FormText>
                                        <FormattedMessage
                                            id='renderer.components.newServerModal.permissions.notifications.mac'
                                            defaultMessage='You may also need to enable notifications in macOS for Platrum Chat. Click <link>here</link> to open the system preferences.'
                                            values={notificationValues}
                                        />
                                    </FormText>
                                    }
                                    {window.process.platform === 'win32' &&
                                        <FormText>
                                            <FormattedMessage
                                                id='renderer.components.newServerModal.permissions.notifications.windows'
                                                defaultMessage='You may also need to enable notifications in Windows for Platrum Chat. Click <link>here</link> to open the notification settings.'
                                                values={notificationValues}
                                            />
                                        </FormText>
                                    }
                                </div>
                            </Toggle>
                            <Toggle
                                isChecked={this.state.permissions.geolocation?.allowed}
                                onChange={this.handleChangePermission('geolocation')}
                            >
                                <i className='icon icon-map-marker-outline'/>
                                <FormattedMessage
                                    id='renderer.components.newServerModal.permissions.geolocation'
                                    defaultMessage='Location'
                                />
                            </Toggle>
                            <Toggle
                                isChecked={this.state.permissions.screenShare?.allowed}
                                onChange={this.handleChangePermission('screenShare')}
                            >
                                <i className='icon icon-monitor-share'/>
                                <FormattedMessage
                                    id='renderer.components.newServerModal.permissions.screenShare'
                                    defaultMessage='Screen share'
                                />
                            </Toggle>
                        </>
                    }
                </Modal.Body>

                <Modal.Footer>
                    {this.props.onClose &&
                        <Button
                            id='cancelNewServerModal'
                            onClick={this.props.onClose}
                            variant='link'
                        >
                            <FormattedMessage
                                id='label.cancel'
                                defaultMessage='Cancel'
                            />
                        </Button>
                    }
                    {this.props.onSave &&
                        <Button
                            id='saveNewServerModal'
                            onClick={this.save}
                            disabled={!this.state.serverHost.length || !this.state.validationResult || this.isServerURLErrored()}
                            variant='primary'
                        >
                            {this.getSaveButtonLabel()}
                        </Button>
                    }
                </Modal.Footer>

            </Modal>
        );
    }
}

export default injectIntl(NewServerModal);
