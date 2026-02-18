// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useState, useCallback, useEffect, useRef} from 'react';
import {useIntl, FormattedMessage} from 'react-intl';

import {MODAL_TRANSITION_TIMEOUT, URLValidationStatus} from 'common/utils/constants';
import Header from 'renderer/components/Header';
import Input, {STATUS, SIZE} from 'renderer/components/Input';
import LoadingBackground from 'renderer/components/LoadingScreen/LoadingBackground';
import SaveButton from 'renderer/components/SaveButton/SaveButton';

import type {UniqueServer} from 'types/config';

import 'renderer/css/components/Button.scss';
import 'renderer/css/components/ConfigureServer.scss';
import 'renderer/css/components/LoadingScreen.css';

import ServerImage from './Images/server';

const PLATRUM_CHAT_SUFFIX = '.chat.platrum.ru';
const PROJECT_HOST_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VALIDATION_DEBOUNCE_MS = 350;
const VALIDATION_TIMEOUT_MS = 5000;

const getProjectHostFromURL = (url: string): string => {
    let host = url.trim();
    host = host.replace(/^https?:\/\//, '');
    host = host.split('/')[0];

    if (host.endsWith(PLATRUM_CHAT_SUFFIX)) {
        host = host.slice(0, -PLATRUM_CHAT_SUFFIX.length);
    }

    return host;
};

const getProjectURLFromHost = (host: string): string => {
    if (!host) {
        return '';
    }
    return `https://${host}${PLATRUM_CHAT_SUFFIX}`;
};

type ConfigureServerProps = {
    server?: UniqueServer;
    prefillURL?: string;
    mobileView?: boolean;
    darkMode?: boolean;
    messageTitle?: string;
    messageSubtitle?: string;
    cardTitle?: string;
    alternateLinkMessage?: string;
    alternateLinkText?: string;
    alternateLinkURL?: string;
    onConnect: (data: UniqueServer) => void;
};

function ConfigureServer({
    server,
    prefillURL,
    mobileView,
    darkMode,
    messageTitle,
    messageSubtitle,
    cardTitle,
    alternateLinkMessage,
    alternateLinkText,
    alternateLinkURL,
    onConnect,
}: ConfigureServerProps) {
    const {formatMessage} = useIntl();

    const {
        name: prevName,
        url: prevURL,
        id,
    } = server || {};

    const mounted = useRef(false);
    const [transition, setTransition] = useState<'inFromRight' | 'outToLeft'>();
    const [name, setName] = useState(prevName ?? '');
    const [host, setHost] = useState(getProjectHostFromURL(prevURL ?? prefillURL ?? ''));
    const [url, setUrl] = useState(prevURL ?? prefillURL ?? getProjectURLFromHost(getProjectHostFromURL(prevURL ?? prefillURL ?? '')));
    const [nameError, setNameError] = useState('');
    const [urlError, setURLError] = useState<{type: STATUS; value: string}>();
    const [showContent, setShowContent] = useState(false);
    const [waiting, setWaiting] = useState(false);

    const [validating, setValidating] = useState(false);
    const validationTimestamp = useRef<number>();
    const validationTimeout = useRef<NodeJS.Timeout>();
    const editing = useRef(false);
    const canSave = Boolean(name && url && !nameError && !validating && urlError && urlError.type !== STATUS.ERROR);

    useEffect(() => {
        setTransition('inFromRight');
        setShowContent(true);
        mounted.current = true;

        if (url) {
            fetchValidationResult(url);
        }

        return () => {
            mounted.current = false;
            clearTimeout(validationTimeout.current as unknown as number);
        };
    }, []);

    const fetchValidationResult = (urlToValidate: string) => {
        setValidating(true);
        setURLError({
            type: STATUS.INFO,
            value: formatMessage({id: 'renderer.components.configureServer.url.validating', defaultMessage: 'Validating...'}),
        });

        const requestTime = Date.now();
        validationTimestamp.current = requestTime;
        validateURL(urlToValidate).then(({validatedURL, message}) => {
            if (editing.current) {
                setValidating(false);
                setURLError(undefined);
                return;
            }
            if (!validationTimestamp.current || requestTime < validationTimestamp.current) {
                return;
            }
            if (validatedURL) {
                setUrl(validatedURL);
                const validatedHost = getProjectHostFromURL(validatedURL);
                setHost(validatedHost);
                setName(validatedHost);
            }
            if (message) {
                setTransition(undefined);
                setURLError(message);
            } else {
                setURLError(undefined);
            }
            setValidating(false);
        });
    };

    const validateURL = async (serverURL: string) => {
        const projectHost = getProjectHostFromURL(serverURL);
        if (!projectHost.length) {
            return {
                validatedURL: serverURL,
                message: {
                    type: STATUS.ERROR,
                    value: formatMessage({
                        id: 'renderer.components.newServerModal.error.urlRequired',
                        defaultMessage: 'Project host is required.',
                    }),
                },
            };
        }

        if (!PROJECT_HOST_REGEX.test(projectHost)) {
            return {
                validatedURL: serverURL,
                message: {
                    type: STATUS.ERROR,
                    value: formatMessage({
                        id: 'renderer.components.newServerModal.error.urlIncorrectFormatting',
                        defaultMessage: 'Project host is not formatted correctly.',
                    }),
                },
            };
        }

        try {
            const validationResult = await Promise.race([
                window.desktop.validateServerURL(serverURL),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('validation timeout')), VALIDATION_TIMEOUT_MS);
                }),
            ]);

            if (!validationResult.serverVersion &&
                validationResult.status !== URLValidationStatus.Missing &&
                validationResult.status !== URLValidationStatus.Invalid) {
                return {
                    validatedURL: validationResult.validatedURL ?? serverURL,
                    message: {
                        type: STATUS.ERROR,
                        value: formatMessage({
                            id: 'renderer.components.configureServer.url.versionUnavailable',
                            defaultMessage: 'Could not validate project host. Please check the host and try again.',
                        }),
                    },
                };
            }

            let message;
            if (validationResult.status === URLValidationStatus.Missing) {
                message = {
                    type: STATUS.ERROR,
                    value: formatMessage({
                        id: 'renderer.components.newServerModal.error.urlRequired',
                        defaultMessage: 'Project host is required.',
                    }),
                };
            } else if (validationResult.status === URLValidationStatus.Invalid) {
                message = {
                    type: STATUS.ERROR,
                    value: formatMessage({
                        id: 'renderer.components.newServerModal.error.urlIncorrectFormatting',
                        defaultMessage: 'Project host is not formatted correctly.',
                    }),
                };
            } else if (validationResult.status === URLValidationStatus.Insecure) {
                message = {
                    type: STATUS.WARNING,
                    value: formatMessage({id: 'renderer.components.configureServer.url.insecure', defaultMessage: 'Your project URL is potentially insecure. For best results, use a URL with the HTTPS protocol.'}),
                };
            } else if (validationResult.status === URLValidationStatus.NotMattermost) {
                message = {
                    type: STATUS.ERROR,
                    value: formatMessage({id: 'renderer.components.configureServer.url.notMattermost', defaultMessage: 'The project host provided does not appear to point to a valid project. Please verify the host and check your connection.'}),
                };
            } else if (validationResult.status === URLValidationStatus.URLNotMatched) {
                message = {
                    type: STATUS.WARNING,
                    value: formatMessage({id: 'renderer.components.configureServer.url.urlNotMatched', defaultMessage: 'The project host does not match your project settings. Please verify the host.'}),
                };
            } else if (validationResult.status === URLValidationStatus.URLUpdated) {
                message = {
                    type: STATUS.INFO,
                    value: formatMessage({id: 'renderer.components.configureServer.url.urlUpdated', defaultMessage: 'The project host was adjusted to match your project settings.'}),
                };
            } else if (validationResult.status === URLValidationStatus.OK) {
                message = {
                    type: STATUS.SUCCESS,
                    value: formatMessage({id: 'renderer.components.configureServer.url.ok', defaultMessage: 'Project host is valid.'}),
                };
            }

            return {
                validatedURL: validationResult.validatedURL ?? serverURL,
                message,
            };
        } catch (error) {
            return {
                validatedURL: serverURL,
                message: {
                    type: STATUS.ERROR,
                    value: formatMessage({
                        id: 'renderer.components.configureServer.url.validationFailed',
                        defaultMessage: 'Could not validate project host. Please check your connection and try again.',
                    }),
                },
            };
        }
    };

    const validateName = () => {
        const newName = name.trim();

        if (!newName) {
            return formatMessage({
                id: 'renderer.components.newServerModal.error.nameRequired',
                defaultMessage: 'Name is required.',
            });
        }

        return '';
    };

    const handleNameOnChange = ({target: {value}}: React.ChangeEvent<HTMLInputElement>) => {
        setName(value);

        if (nameError) {
            setNameError('');
        }
    };

    const handleURLOnChange = ({target: {value}}: React.ChangeEvent<HTMLInputElement>) => {
        const projectHost = getProjectHostFromURL(value);
        setHost(projectHost);
        setName(projectHost);
        const serverUrl = getProjectURLFromHost(projectHost);
        setUrl(serverUrl);

        if (urlError) {
            setURLError(undefined);
        }

        editing.current = true;
        clearTimeout(validationTimeout.current as unknown as number);
        validationTimeout.current = setTimeout(() => {
            if (!mounted.current) {
                return;
            }
            editing.current = false;
            fetchValidationResult(serverUrl);
        }, VALIDATION_DEBOUNCE_MS);
    };

    const handleOnSaveButtonClick = (e: React.MouseEvent) => {
        submit(e);
    };

    const handleOnCardEnterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            submit(e);
        }
    };

    const submit = async (e: React.MouseEvent | React.KeyboardEvent) => {
        e.preventDefault();

        if (!canSave || waiting) {
            return;
        }

        setWaiting(true);

        const nameError = validateName();

        if (nameError) {
            setTransition(undefined);
            setNameError(nameError);
            setWaiting(false);
            return;
        }

        setTransition('outToLeft');

        setTimeout(() => {
            onConnect({
                url,
                name,
                id,
            });
        }, MODAL_TRANSITION_TIMEOUT);
    };

    const getAlternateLink = useCallback(() => {
        if (!alternateLinkURL || !alternateLinkMessage || !alternateLinkText) {
            return undefined;
        }

        return (
            <div className={classNames('alternate-link', transition, {'alternate-link-inverted': darkMode})}>
                <span className='alternate-link__message'>
                    {alternateLinkMessage}
                </span>
                <a
                    className={classNames(
                        'link-button link-small-button alternate-link__link',
                        {'link-button-inverted': darkMode},
                    )}
                    href={alternateLinkURL}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    {alternateLinkText}
                </a>
            </div>
        );
    }, [transition, darkMode, alternateLinkURL, alternateLinkMessage, alternateLinkText]);

    return (
        <div
            className={classNames(
                'LoadingScreen',
                {'LoadingScreen--darkMode': darkMode},
                'ConfigureServer',
                {'ConfigureServer-inverted': darkMode},
            )}
        >
            <LoadingBackground/>
            {false && <Header
                darkMode={darkMode}
                alternateLink={mobileView ? getAlternateLink() : undefined}
            />}
            {showContent && (
                <div className='ConfigureServer__body'>
                    {!mobileView && getAlternateLink()}
                    <div className='ConfigureServer__content'>
                        <div className={classNames('ConfigureServer__message', transition)}>
                            {false && <div className='ConfigureServer__message-img'>
                                <ServerImage/>
                            </div>}
                            <h1 className='ConfigureServer__message-title'>
                                {messageTitle || formatMessage({id: 'renderer.components.configureServer.title', defaultMessage: 'Let’s connect to a project'})}
                            </h1>
                            <p className='ConfigureServer__message-subtitle'>
                                {false && (messageSubtitle || (
                                    <FormattedMessage
                                        id='renderer.components.configureServer.subtitle'
                                        defaultMessage='Set up your first project to connect to your<br></br>team’s communication hub'
                                        values={{
                                            br: (x: React.ReactNode) => (<><br/>{x}</>),
                                        }}
                                    />))
                                }
                            </p>
                        </div>
                        <div className={classNames('ConfigureServer__card', transition, {'with-error': nameError || urlError?.type === STATUS.ERROR})}>
                            <div
                                className='ConfigureServer__card-content'
                                onKeyDown={handleOnCardEnterKeyDown}
                                tabIndex={0}
                            >
                                <p className='ConfigureServer__card-title'>
                                    {cardTitle || formatMessage({id: 'renderer.components.configureServer.cardtitle', defaultMessage: 'Enter your project host'})}
                                </p>
                                <div className='ConfigureServer__card-form'>
                                    <Input
                                        name='url'
                                        className='ConfigureServer__card-form-input'
                                        type='text'
                                        inputSize={SIZE.LARGE}
                                        value={host}
                                        onChange={handleURLOnChange}
                                        customMessage={urlError ?? ({
                                            type: STATUS.INFO,
                                            value: formatMessage({id: 'renderer.components.configureServer.url.info', defaultMessage: 'Enter your project host, for example: example'}),
                                        })}
                                        placeholder={formatMessage({id: 'renderer.components.configureServer.url.placeholder', defaultMessage: 'Project host'})}
                                        disabled={waiting}
                                    />
                                    {false && <Input
                                        name='name'
                                        className='ConfigureServer__card-form-input'
                                        containerClassName='ConfigureServer__card-form-input-container'
                                        type='text'
                                        inputSize={SIZE.LARGE}
                                        value={name}
                                        onChange={handleNameOnChange}
                                        customMessage={nameError ? ({
                                            type: STATUS.ERROR,
                                            value: nameError,
                                        }) : ({
                                            type: STATUS.INFO,
                                            value: formatMessage({id: 'renderer.components.configureServer.name.info', defaultMessage: 'The name that will be displayed in your project list'}),
                                        })}
                                        placeholder={formatMessage({id: 'renderer.components.configureServer.name.placeholder', defaultMessage: 'Project display name'})}
                                        disabled={waiting}
                                    />}
                                    <SaveButton
                                        id='connectConfigureServer'
                                        extraClasses='ConfigureServer__card-form-button'
                                        saving={waiting}
                                        onClick={handleOnSaveButtonClick}
                                        defaultMessage={urlError?.type === STATUS.WARNING ?
                                            formatMessage({id: 'renderer.components.configureServer.connect.override', defaultMessage: 'Connect anyway'}) :
                                            formatMessage({id: 'renderer.components.configureServer.connect.default', defaultMessage: 'Connect'})
                                        }
                                        savingMessage={formatMessage({id: 'renderer.components.configureServer.connect.saving', defaultMessage: 'Connecting…'})}
                                        disabled={!canSave}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <div className='ConfigureServer__footer'/>
        </div>
    );
}

export default ConfigureServer;
